// dsh-mini: an interactive coding-agent CLI.
// The pi-CLI idea in minimal form: pi's shell conventions (TUI, sessions
// directory, resume UX) + DSH's engine AND state (AgentLoop, ToolRuntime,
// event-sourced sessions with the DSH JSONL persistence backend).
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
import * as readline from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const API_KEY = process.env.GEMINI_API_KEY ?? "GEMINI_API_KEY_REDACTED";
const CWD = process.cwd();
const SESSIONS_DIR = process.env.DSH_SESSIONS ?? join(homedir(), ".dsh-mini", "sessions");
// ANSI TUI when both stdio ends are terminals (pipes/CI get plain mode).
const TTY = !!process.stdout.isTTY && !!process.stdin.isTTY && !process.env.DSH_PLAIN;

// CLI args: node cli.mjs [model] [--resume <id>] [--sessions]
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FLAGS = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => [a, true]));
const RESUME_INDEX = process.argv.indexOf("--resume");
const RESUME_ID = RESUME_INDEX >= 0 ? process.argv[RESUME_INDEX + 1] : undefined;
const LIST_SESSIONS = process.argv.includes("--sessions");
const MODEL = ARGS[0] ?? "gemini-flash-latest";

const PERSONA = [
	"You are dsh-mini, a compact interactive coding agent CLI built on the DeepSeek Harness core.",
	"You help the user with coding tasks inside the current workspace directory.",
	"Prefer the read/list tools to inspect files, the edit tool for targeted changes, and the write tool to create or replace files.",
	"Use todo_write to track multi-step work.",
	"Keep replies concise and use the language the user writes in.",
].join(" ");

// ---- terminal rendering ----

const out = (s) => process.stdout.write(s);

function renderEvent(event, ui) {
	const d = event.data ?? {};
	switch (event.type) {
		case "assistant/chunk": {
			const c = d.chunk;
			if (c.type === "text-delta") out(c.text);
			break;
		}
		case "tool/call":
			out(`\n⚙ ${d.name} ${d.arguments}\n`);
			break;
		case "tool/result": {
			const result = d.message?.content?.[0];
			const blocks = result?.content ?? [];
			const text = blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n")
				.slice(0, 240);
			out(`${result?.isError ? "✗" : "✓"} ${text}\n`);
			break;
		}
		case "assistant/message": {
			if (d.usage) ui?.setUsage(d.usage);
			out("\n");
			break;
		}
		case "turn/end":
			if (d.reason?.kind === "error") {
				out(`\n[error] ${JSON.stringify(d.reason.error ?? {})}\n`);
			}
			break;
	}
}

function makeStatusBar({ getModel, getUsage }) {
	let last = "";
	const draw = () => {
		const usage = getUsage();
		const line = `dsh-mini · ${getModel()} · ${CWD}${usage ? ` · ↑${usage.inputTokens ?? 0} ↓${usage.outputTokens ?? 0}` : ""}`;
		if (line === last) return;
		last = line;
		// save cursor → top line → clear → draw → restore
		out(`\x1b[s\x1b[H\x1b[2K${line}\x1b[u`);
	};
	return { draw };
}

// ---- boot + REPL ----

process.on("unhandledRejection", (r) => console.error("[proc] unhandledRejection:", r?.stack ?? String(r)));

const boot = async (ctx) => {
	ctx.llm.registerAdapter(["google"], new GeminiAdapter(API_KEY));

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
			console.log(`(resumed ${RESUME_ID})`);
		} catch (err) {
			console.error("[resume] FAILED:", err?.stack ?? String(err));
			throw err;
		}
	} else {
		agent = makeAgent(currentModel);
	}
	let usage = undefined;
	const status = TTY ? makeStatusBar({ getModel: () => currentModel, getUsage: () => usage }) : { draw() {} };

	ctx.on("session/event", (subject, event) => {
		if (subject !== agent.session) return;
		if (process.env.DSH_DEBUG && event.type === "request/header") {
			console.error("[debug] header.tools:", JSON.stringify(event.data?.header?.tools ?? null).slice(0, 300));
		}
		try {
			renderEvent(event, { setUsage: (u) => (usage = u) });
		} catch {
			// rendering must never break the loop
		}
		status.draw();
	});

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: TTY });
	rl.on("close", () => process.exit(0));

	out("\n");
	console.log(`dsh-mini — DSH core + ${MODEL} @ Google AI Studio`);
	console.log(`workspace: ${CWD}`);
	console.log(`session: ${agent.session.id}   (stored in ${SESSIONS_DIR})`);
	console.log("commands: /clear  /model <id>  /sessions  /exit   (AI Studio 免费配额按模型独立，429 就换模型)");
	console.log("");
	status.draw();

	const ask = () => {
		rl.question("you> ", async (line) => {
			const trimmed = line.trim();
			try {
				if (trimmed === "/exit" || trimmed === "/quit") {
					rl.close();
					process.exit(0);
				}
				if (trimmed === "") return ask();
				if (trimmed === "/clear") {
					agent.cancel({ kind: "user-clear" });
					agent = makeAgent(currentModel);
					console.log(`(new session: ${agent.session.id})`);
					status.draw();
					return ask();
				}
				if (trimmed === "/sessions") {
					const headers = await ctx.sessionPersistence.list();
					for (const header of headers) {
						console.log(`${header.id}\t${header.cwd ?? ""}\t${header.createdAt ?? ""}\t${header.eventCount ?? ""}`);
					}
					return ask();
				}
				if (trimmed.startsWith("/model ")) {
					const next = trimmed.slice(7).trim();
					if (next) {
						agent.cancel({ kind: "user-model-switch" });
						currentModel = next;
						agent = makeAgent(next);
						console.log(`(switched to ${next}, new session: ${agent.session.id})`);
						status.draw();
					}
					return ask();
				}
				agent.followup(createUserMessage({ content: [{ type: "text", text: trimmed }], source: { kind: "user" } }));
				await agent.whenIdle();
				status.draw();
				out("\n");
				ask();
			} catch (error) {
				console.error("CLI error:", error?.stack ?? String(error));
				ask();
			}
		});
	};
	ask();
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
mount("persistence", persistenceJsonl.JsonlSessionPersistence, { root: SESSIONS_DIR });
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
