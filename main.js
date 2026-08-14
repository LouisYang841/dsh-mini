// DSH core spike driver.
// Boots the REAL cordis services (AgentRegistry, SessionStore, SystemPrompt,
// ToolRuntime, AgentLoop) with a FAKE llm service, then replays five scripted
// scenarios and prints the normalized event-sourced session traces as JSON.
// The same bundle must produce byte-identical output on Node and QuickJS.
import "./polyfills.js";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { ToolRuntime, defineContentToolFixture } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { FakeLlm } from "./fake-llm.js";

const CWD = "/home/ubuntu/Dsh_workspace/spike";

function user(text) {
	return createUserMessage({ content: [{ type: "text", text }] });
}

// ---- scripted provider scenarios (chunk scripts, one per stream() call) ----

function textScript(text) {
	return {
		chunks: [
			{ type: "block-start", index: 0, blockType: "text" },
			{ type: "text-delta", index: 0, text },
			{ type: "block-end", index: 0, block: { type: "text", text } },
			{ type: "finish", reason: { kind: "stop" } },
		],
	};
}

function toolCallScript(name, args, callId) {
	const json = JSON.stringify(args);
	return {
		chunks: [
			{ type: "block-start", index: 0, blockType: "tool-call" },
			{ type: "tool-call-delta", index: 0, id: callId, name, argumentsDelta: json },
			{ type: "block-end", index: 0, block: { type: "tool-call", id: callId, name, arguments: json } },
			{ type: "finish", reason: { kind: "stop" } },
		],
	};
}

// One parallel-safe tool + one exclusive tool in a single assistant message:
// exercises the scheduler's pool/barrier split with model-ordered commits.
function twoToolCallScript() {
	return {
		chunks: [
			{ type: "block-start", index: 0, blockType: "tool-call" },
			{ type: "tool-call-delta", index: 0, id: "call-a", name: "mock_echo", argumentsDelta: '{"text":"A"}' },
			{ type: "block-end", index: 0, block: { type: "tool-call", id: "call-a", name: "mock_echo", arguments: '{"text":"A"}' } },
			{ type: "block-start", index: 1, blockType: "tool-call" },
			{ type: "tool-call-delta", index: 1, id: "call-b", name: "mock_exclusive", argumentsDelta: '{"text":"B"}' },
			{ type: "block-end", index: 1, block: { type: "tool-call", id: "call-b", name: "mock_exclusive", arguments: '{"text":"B"}' } },
			{ type: "finish", reason: { kind: "stop" } },
		],
	};
}

// Truncated by the output token limit: the turn must end with reason
// max-tokens and the partial text must be retained.
function maxTokensScript() {
	return {
		chunks: [
			{ type: "block-start", index: 0, blockType: "text" },
			{ type: "text-delta", index: 0, text: "Hello wor" },
			{ type: "finish", reason: { kind: "max-tokens" } },
		],
	};
}

// ---- trace normalization: volatile values become placeholders ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOLATILE_KEYS = new Set(["id", "timestamp", "createdAt", "sentAt", "completedAt", "stack"]);

function normalize(v) {
	if (typeof v === "string") {
		if (UUID_RE.test(v)) return "«uuid»";
		return v;
	}
	if (Array.isArray(v)) return v.map(normalize);
	if (v && typeof v === "object") {
		const out = {};
		for (const k of Object.keys(v)) {
			if (VOLATILE_KEYS.has(k)) {
				out[k] = "«" + k + "»";
				continue;
			}
			out[k] = normalize(v[k]);
		}
		return out;
	}
	return v;
}

// ---- scenario runner ----

async function runScenario(ctx, id, steps, drive) {
	globalThis.__FAKE_STEPS = steps.slice();
	const agent = ctx.agentLoop.create(id, { provider: "fake", model: "fake-1" }, { cwd: CWD });
	await drive(agent);
	await agent.whenIdle();
	const events = agent.session.events.map((e) => ({ seq: e.seq, type: e.type, data: normalize(e.data) }));
	return { scenario: id, events };
}

// ---- main ----

// Cordis services live in each plugin fiber's store and only contexts that
// INJECT a service can read it as `ctx.<name>`. Drive everything from a boot
// plugin whose inject list mirrors AgentLoop's own dependencies.
const boot = async (ctx) => {
	ctx.tools.register(
		defineContentToolFixture({
			name: "mock_echo",
			description: "Echo text.",
			parameters: { text: { type: "string", required: true, description: "text to echo" } },
			isConcurrencySafe: () => true,
			async execute(args) {
				return [{ type: "text", text: "echo:" + args.text }];
			},
		}),
	);
	ctx.tools.register(
		defineContentToolFixture({
			name: "mock_exclusive",
			description: "Exclusive echo.",
			parameters: { text: { type: "string", required: true, description: "text to echo" } },
			async execute(args) {
				return [{ type: "text", text: "excl:" + args.text }];
			},
		}),
	);

	const results = [];

	// A: plain text turn
	results.push(
		await runScenario(ctx, "a-text", [textScript("Hello from the fake provider")], (agent) => {
			agent.followup(user("hello"));
		}),
	);

	// B: single tool call round-trip
	results.push(
		await runScenario(ctx, "b-tool", [toolCallScript("mock_echo", { text: "hi" }, "call-1"), textScript("done after tool")], (agent) => {
			agent.followup(user("echo hi"));
		}),
	);

	// C: parallel-safe + exclusive tools in one message
	results.push(
		await runScenario(ctx, "c-parallel-exclusive", [twoToolCallScript(), textScript("both done")], (agent) => {
			agent.followup(user("run both"));
		}),
	);

	// D: max-tokens truncation ends the turn; follow-up opens a new turn
	results.push(
		await runScenario(ctx, "d-max-tokens", [maxTokensScript(), textScript("ld, finished.")], async (agent) => {
			agent.followup(user("go"));
			await agent.whenIdle();
			agent.followup(user("continue"));
		}),
	);

	// E: steering message injected mid-turn (next-step inbox target)
	results.push(
		await runScenario(ctx, "e-steer", [textScript("First."), textScript("Second.")], (agent) => {
			const steps = globalThis.__FAKE_STEPS;
			steps[0].onStream = () => agent.steer(user("interrupt"));
			agent.followup(user("start"));
		}),
	);

	print(JSON.stringify(results));
};
boot.inject = ["agents", "sessions", "tools", "systemPrompt", "agentLoop"];

const root = new Context();
root.plugin(AgentRegistry);
root.plugin(SessionStore);
root.plugin(SystemPrompt, { persona: "", includeHarnessIdentity: false, includeRuntimeContext: false });
root.plugin(ToolRuntime, { mode: "native" });
root.plugin(FakeLlm);
root.plugin(AgentLoop, { maxParallelToolCalls: 2 });
root.plugin(boot).then(
	() => {},
	(err) => printErr("SPIKE FAILED: " + (err && err.stack ? err.stack : String(err))),
);
