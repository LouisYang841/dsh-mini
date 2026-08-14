// dsh-mini: an interactive coding-agent CLI.
// pi's shell (the real @earendil-works/pi-tui framework) + DSH's engine AND
// state (AgentLoop, ToolRuntime, event-sourced sessions, JSONL persistence).
import "../polyfills.js";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import { LlmRuntime, createUserMessage } from "@deepseek-ai/dsh-llm";
import * as fsTools from "@deepseek-ai/dsh-tool-fs";
import * as todoTools from "@deepseek-ai/dsh-tool-todo";
import * as persistenceJsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
import { GeminiAdapter } from "./gemini-adapter.js";
import { NodeFs } from "./node-fs.js";
import { createTuiHost } from "./tui-renderer.js";
import { defineBashTool, bashGuidanceSection } from "./bash-tool.js";
import * as readline from "node:readline";
import { join } from "node:path";
import { zstdCompress } from "node:zlib";
import { homedir } from "node:os";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
	console.error("GEMINI_API_KEY is required (create one at https://aistudio.google.com/apikey).");
	process.exit(1);
}
const CWD = process.cwd();
const SESSIONS_DIR = process.env.DSH_SESSIONS ?? join(homedir(), ".dsh-mini", "sessions");
// node:zlib zstd is built into Node >= 22.15 (no system lib); degrade to
// uncompressed JSONL on older runtimes (e.g. some Termux images).
const HAS_ZSTD = typeof zstdCompress === "function";
if (!HAS_ZSTD) console.error("[warn] node:zlib zstd unavailable (Node < 22.15): sessions will be stored uncompressed");
// pi-tui shell when both stdio ends are terminals (pipes/CI get plain mode).
const TTY = !!process.stdout.isTTY && !!process.stdin.isTTY && !process.env.DSH_PLAIN;

// CLI args: node cli.mjs [model] [--resume <id>] [--sessions]
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const RESUME_INDEX = process.argv.indexOf("--resume");
const RESUME_ID = RESUME_INDEX >= 0 ? process.argv[RESUME_INDEX + 1] : undefined;
const LIST_SESSIONS = process.argv.includes("--sessions");
const MODEL = ARGS[0] ?? "gemini-flash-latest";

const PERSONA = [
	"You are dsh-mini, a compact interactive coding agent CLI built on the DeepSeek Harness core.",
	"You help the user with coding tasks inside the current workspace directory.",
	"Prefer the read/list tools to inspect files, the edit tool for targeted changes, and the write tool to create or replace files.",
	"Use todo_write to track multi-step work. A bash tool is available for builds, tests, and git — prefer file tools for plain file work.",
	"Keep replies concise and use the language the user writes in.",
].join(" ");

// ---- boot ----

process.on("unhandledRejection", (r) => console.error("[proc] unhandledRejection:", r?.stack ?? String(r)));

const boot = async (ctx) => {
	ctx.llm.registerAdapter(["google"], new GeminiAdapter(API_KEY));
	ctx.tools.register(defineBashTool());
	ctx.systemPrompt.section(bashGuidanceSection());

	if (LIST_SESSIONS) {
		const headers = await ctx.sessionPersistence.list();
		for (const header of headers) {
			console.log(`${header.id}\t${header.cwd ?? ""}\t${header.createdAt ?? ""}\t${header.eventCount ?? ""}`);
		}
		process.exit(0);
	}

	const makeAgent = (model) => {
		return ctx.agentLoop.create(
			`cli-${Date.now().toString(36)}`,
			{ provider: "google", model },
			{ cwd: CWD },
		);
	};

	let agent;
	let currentModel = MODEL;
	if (RESUME_ID) {
		try {
			const published = await Promise.race([
				ctx.agentLoop.resume(ctx, {
					resumeSessionId: RESUME_ID,
					agentOptions: { provider: "google", model: currentModel },
				}),
				new Promise((_, rej) => setTimeout(() => rej(new Error("resume timed out after 10s")), 10000)),
			]);
			agent = published.agent;
		} catch (err) {
			console.error("[resume] FAILED:", err?.stack ?? String(err));
			process.exit(1);
		}
	} else {
		agent = makeAgent(currentModel);
	}

	let usage = undefined;
	let busy = false;

	const statusLine = () =>
		`dsh-mini · ${currentModel} · ${agent.session.id}${usage ? ` · ↑${usage.inputTokens ?? 0} ↓${usage.outputTokens ?? 0}` : ""}`;

	// ---- renderer: pi-tui shell or plain terminal ----

	const ui = TTY
		? createTuiHost({
				onLine: (line) => void handleLine(line),
				onInterrupt: () => {
					if (busy) agent.cancel({ kind: "user-interrupt" });
				},
			})
		: null;

	if (ui) {
		ui.setStatus(statusLine());
	} else {
		console.log(`dsh-mini — DSH core + ${MODEL} @ Google AI Studio`);
		console.log(`workspace: ${CWD}`);
		console.log(`session: ${agent.session.id}   (stored in ${SESSIONS_DIR})`);
		console.log("commands: /clear  /model <id>  /sessions  /exit   (AI Studio 免费配额按模型独立，429 就换模型)");
		console.log("");
	}

	// ---- shared input handling ----

	async function handleLine(line) {
		const trimmed = line.trim();
		try {
			if (trimmed === "/exit" || trimmed === "/quit") {
				process.exit(0);
			}
			if (trimmed === "") return;
			if (trimmed === "/clear") {
				agent.cancel({ kind: "user-clear" });
				agent = makeAgent(currentModel);
				if (ui) ui.setStatus(statusLine());
				else console.log(`(new session: ${agent.session.id})`);
				return;
			}
			if (trimmed === "/stats") {
				const events = agent.session.events;
				let turns = 0;
				let userMsgs = 0;
				let assistantMsgs = 0;
				let toolCalls = 0;
				let inTok = 0;
				let outTok = 0;
				let cachedTok = 0;
				for (const e of events) {
					if (e.type === "turn/start") turns += 1;
					else if (e.type === "user/message") userMsgs += 1;
					else if (e.type === "assistant/message") {
						assistantMsgs += 1;
						const u = e.data?.usage;
						if (u) {
							inTok += u.inputTokens ?? 0;
							outTok += u.outputTokens ?? 0;
							cachedTok += u.cachedInputTokens ?? 0;
						}
					} else if (e.type === "tool/call") toolCalls += 1;
				}
				const row = `turns=${turns} messages=${userMsgs}/${assistantMsgs} tools=${toolCalls} tokens=\u2191${inTok} \u2193${outTok} (cached ${cachedTok})`;
				if (ui) ui.addToolResult(row, false);
				else console.log(row);
				return;
			}
			if (trimmed === "/sessions") {
				const headers = await ctx.sessionPersistence.list();
				for (const header of headers) {
					const row = `${header.id}\t${header.cwd ?? ""}\t${header.createdAt ?? ""}\t${header.eventCount ?? ""}`;
					if (ui) ui.addToolResult(row, false);
					else console.log(row);
				}
				return;
			}
			if (trimmed.startsWith("/model ")) {
				const next = trimmed.slice(7).trim();
				if (next) {
					agent.cancel({ kind: "user-model-switch" });
					currentModel = next;
					agent = makeAgent(next);
					if (ui) ui.setStatus(statusLine());
					else console.log(`(switched to ${next}, new session: ${agent.session.id})`);
				}
				return;
			}
			busy = true;
			ui?.setBusy(true);
			agent.followup(createUserMessage({ content: [{ type: "text", text: trimmed }], source: { kind: "user" } }));
			await agent.whenIdle();
		} catch (error) {
			console.error("CLI error:", error?.stack ?? String(error));
		} finally {
			busy = false;
			ui?.setBusy(false);
			ui?.focus();
		}
	};

	// ---- session event projection ----

	const renderEvent = (event) => {
		const d = event.data ?? {};
		switch (event.type) {
			case "assistant/chunk": {
				const c = d.chunk;
				if (c.type === "text-delta") {
					if (ui) ui.appendAssistant(c.text);
					else process.stdout.write(c.text);
				}
				break;
			}
			case "tool/call":
				if (ui) ui.addTool(`${d.name} ${d.arguments}`);
				else process.stdout.write(`\n⚙ ${d.name} ${d.arguments}\n`);
				break;
			case "tool/result": {
				const result = d.message?.content?.[0];
				const blocks = result?.content ?? [];
				const text = blocks
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n")
					.slice(0, 240);
				if (ui) ui.addToolResult(text, !!result?.isError);
				else process.stdout.write(`${result?.isError ? "✗" : "✓"} ${text}\n`);
				break;
			}
			case "assistant/message": {
				if (d.usage) {
					usage = d.usage;
					if (ui) ui.setStatus(statusLine());
				}
				if (ui) ui.endAssistant();
				else process.stdout.write("\n");
				break;
			}
			case "turn/end":
				if (d.reason?.kind === "error") {
					const text = JSON.stringify(d.reason.error ?? {});
					if (ui) ui.addError(text);
					else process.stdout.write(`\n[error] ${text}\n`);
				}
				break;
		}
	};

	ctx.on("session/event", (subject, event) => {
		if (subject !== agent.session) return;
		if (process.env.DSH_DEBUG && event.type === "request/header") {
			console.error("[debug] header.tools:", JSON.stringify(event.data?.header?.tools ?? null).slice(0, 300));
		}
		try {
			renderEvent(event);
		} catch {
			// rendering must never break the loop
		}
	});

	// ---- plain-mode REPL (pi-tui drives its own input) ----

	if (!ui) {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
		rl.on("close", () => process.exit(0));
		const ask = () => {
			rl.question("you> ", async (line) => {
				await handleLine(line);
				process.stdout.write("\n");
				ask();
			});
		};
		ask();
	}
};
boot.inject = ["agents", "sessions", "llm", "tools", "systemPrompt", "agentLoop", "sessionPersistence"];

const root = new Context();
const mount = (label, plugin, config) => {
	root.plugin(plugin, config).then(
		() => {},
		(err) => console.error(`[mount] ${label} FAILED:`, err?.stack ?? String(err)),
	);
};
mount("agents", AgentRegistry);
mount("sessions", SessionStore);
mount("systemPrompt", SystemPrompt, { persona: PERSONA, includeHarnessIdentity: true, includeRuntimeContext: false });
mount("tools", ToolRuntime, { mode: "native" });
mount("llm", LlmRuntime);
mount("fs", NodeFs, { cwd: CWD });
mount("persistence", persistenceJsonl.JsonlSessionPersistence, { root: SESSIONS_DIR, ...(HAS_ZSTD ? {} : { compression: "none" }) });
mount("tool-fs", fsTools);
mount("tool-todo", todoTools);
mount("agentLoop", AgentLoop, { maxParallelToolCalls: 4 });
root.plugin(boot).then(
	() => {},
	(err) => {
		console.error("dsh-mini failed to boot:", err?.stack ?? String(err));
		process.exit(1);
	},
);
