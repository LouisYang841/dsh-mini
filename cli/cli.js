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
import * as deepseekLlm from "@deepseek-ai/dsh-llm-deepseek";
import { GeminiAdapter } from "./gemini-adapter.js";
import { NodeFs } from "./node-fs.js";
import { createTuiHost } from "./tui-renderer.js";
import { defineBashTool, bashGuidanceSection } from "./bash-tool.js";
import * as readline from "node:readline";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { zstdCompress } from "node:zlib";
import { homedir } from "node:os";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CWD = process.cwd();
const SESSIONS_DIR = process.env.DSH_SESSIONS ?? join(homedir(), ".dsh-mini", "sessions");
// node:zlib zstd is built into Node >= 22.15 (no system lib); degrade to
// uncompressed JSONL on older runtimes (e.g. some Termux images).
const HAS_ZSTD = typeof zstdCompress === "function";
if (!HAS_ZSTD) console.error("[warn] node:zlib zstd unavailable (Node < 22.15): sessions will be stored uncompressed");
// pi-tui shell when both stdio ends are terminals (pipes/CI get plain mode).
const TTY = !!process.stdout.isTTY && !!process.stdin.isTTY && !process.env.DSH_PLAIN;

// CLI args: node cli.mjs [model] [--provider <id>] [--resume <id>] [--sessions]
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const RESUME_INDEX = process.argv.indexOf("--resume");
const RESUME_ID = RESUME_INDEX >= 0 ? process.argv[RESUME_INDEX + 1] : undefined;
const PROVIDER_INDEX = process.argv.indexOf("--provider");
const PROVIDER_OVERRIDE = PROVIDER_INDEX >= 0 ? process.argv[PROVIDER_INDEX + 1] : undefined;
const LIST_SESSIONS = process.argv.includes("--sessions");
// DeepSeek is the default provider (this is dsh, after all): the DSH-native
// dsh-llm-deepseek adapter owns the "deepseek-official" route.
const PROVIDER_DEFAULTS = {
	"deepseek-official": { model: "deepseek-v4-flash", keyEnv: "DEEPSEEK_API_KEY" },
	google: { model: "gemini-flash-latest", keyEnv: "GEMINI_API_KEY" },
};
const PROVIDER = PROVIDER_OVERRIDE ?? process.env.DSH_PROVIDER ?? (process.env.DEEPSEEK_API_KEY || !process.env.GEMINI_API_KEY ? "deepseek-official" : "google");
const MODEL = ARGS[0] ?? PROVIDER_DEFAULTS[PROVIDER]?.model ?? "deepseek-v4-flash";

const PERSONA = [
	"You are dsh-mini, a compact interactive coding agent CLI built on the DeepSeek Harness core.",
	"You help the user with coding tasks inside the current workspace directory.",
	"Prefer the read/list tools to inspect files, the edit tool for targeted changes, and the write tool to create or replace files.",
	"Use todo_write to track multi-step work. A bash tool is available for builds, tests, and git — prefer file tools for plain file work.",
	"Keep replies concise and use the language the user writes in.",
].join(" ");

// ---- boot ----

process.on("unhandledRejection", (r) => console.error("[proc] unhandledRejection:", r?.stack ?? String(r)));

// Minimal env loader: ~/.dsh-mini/env then ./.env (gitignored), KEY=VALUE
// lines, never overriding the real environment.
for (const envFile of [join(homedir(), ".dsh-mini", "env"), join(CWD, ".env")]) {
	try {
		if (!existsSync(envFile)) continue;
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
			if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
		}
	} catch {
		// unreadable env file is not fatal
	}
}

// Persist an interactively entered key: user config dir first, cwd .env
// fallback (both gitignored; never touch the repo's tracked files).
function persistCredential(provider, key) {
	const env = PROVIDER_DEFAULTS[provider].keyEnv;
	for (const target of [join(homedir(), ".dsh-mini", "env"), join(CWD, ".env")]) {
		try {
			mkdirSync(dirname(target), { recursive: true });
			const previous = existsSync(target) ? readFileSync(target, "utf8").replace(new RegExp(`^${env}=.*$`, "m"), "").trimEnd() : "";
			writeFileSync(target, `${previous}${previous ? "\n" : ""}${env}=${key}\n`);
			console.log(`(saved ${env} to ${target})`);
			return;
		} catch {
			// try the next target
		}
	}
	console.error(`[warn] could not persist ${env}; it is set for this session only`);
}

const AGENTS_MD_CAP = 30 * 1024; // keep injected instructions bounded

const boot = async (ctx) => {
	if (GEMINI_KEY) ctx.llm.registerAdapter(["google"], new GeminiAdapter(GEMINI_KEY));
	ctx.tools.register(defineBashTool());
	ctx.systemPrompt.section(bashGuidanceSection());
	// Workspace instructions: inject <cwd>/AGENTS.md so the agent starts every
	// session knowing this repo's rules (docs-for-agents over tools-for-agents).
	if (!process.env.DSH_NO_AGENTS) {
		const agentsPath = join(CWD, "AGENTS.md");
		if (existsSync(agentsPath)) {
			const instructions = readFileSync(agentsPath, "utf8").slice(0, AGENTS_MD_CAP);
			ctx.systemPrompt.section({
				name: "workspace:agents",
				order: -90,
				text: `<workspace_instructions file="AGENTS.md">\n${instructions}\n</workspace_instructions>`,
			});
		}
	}

	if (LIST_SESSIONS) {
		const headers = await ctx.sessionPersistence.list();
		for (const header of headers) {
			console.log(`${header.id}\t${header.cwd ?? ""}\t${header.createdAt ?? ""}\t${header.eventCount ?? ""}`);
		}
		process.exit(0);
	}

	const makeAgent = (model, provider = PROVIDER) => {
		return ctx.agentLoop.create(
			`cli-${Date.now().toString(36)}`,
			{ provider, model },
			{ cwd: CWD },
		);
	};

	let agent = null;
	let busy = false;

	// ---- renderer first: interactive setup needs it before the agent exists ----
	const ui = TTY
		? createTuiHost({
				onLine: (line) => void handleLine(line),
				onInterrupt: () => {
					if (busy && agent) agent.cancel({ kind: "user-interrupt" });
				},
			})
		: null;

	let plainRl = null;
	let stdinClosed = false;
	// Piped stdin delivers whole chunks at once, so rl.question misses lines
	// that arrive before the next question is registered. A persistent
	// listener + queue fixes it: early lines queue, askUser drains the queue.
	let lineQueue = [];
	let lineResolver = null;
	if (!ui) {
		plainRl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
		plainRl.on("line", (line) => {
			if (lineResolver) {
				const resolve = lineResolver;
				lineResolver = null;
				resolve(line);
			} else {
				lineQueue.push(line);
			}
		});
		// Exit on stdin EOF only when idle: a closing pipe must not kill a
		// turn that is still streaming.
		plainRl.on("close", () => {
			stdinClosed = true;
			if (!busy) process.exit(0);
		});
	}
	const askUser = (question) => {
		process.stdout.write(question);
		if (ui) return ui.ask(question);
		return new Promise((resolve) => {
			if (lineQueue.length > 0) resolve(lineQueue.shift());
			else lineResolver = resolve;
		});
	};

	let currentProvider = PROVIDER;
	let currentModel = MODEL;
	if (!process.env[PROVIDER_DEFAULTS[currentProvider]?.keyEnv]) {
		const hasAnyKey = Object.values(PROVIDER_DEFAULTS).some((def) => process.env[def.keyEnv]);
		if (hasAnyKey) {
			console.error(`[warn] ${PROVIDER_DEFAULTS[currentProvider].keyEnv} is not set: ${currentProvider} calls will fail with MISSING_CREDENTIAL`);
		} else {
			// First run: no keys anywhere — interactive provider + key setup.
			console.log("No API key detected. Configure a provider:");
			const answer = (await askUser("provider (deepseek-official/google) [deepseek-official]: ")).trim() || "deepseek-official";
			if (!PROVIDER_DEFAULTS[answer]) {
				console.error(`unknown provider "${answer}" (known: ${Object.keys(PROVIDER_DEFAULTS).join(", ")})`);
				process.exit(1);
			}
			currentProvider = answer;
			currentModel = PROVIDER_DEFAULTS[answer].model;
			const key = (await askUser(`${PROVIDER_DEFAULTS[answer].keyEnv}: `)).trim();
			if (!key) {
				console.error("empty API key; set the env var and restart");
				process.exit(1);
			}
			process.env[PROVIDER_DEFAULTS[answer].keyEnv] = key;
			persistCredential(answer, key);
		}
	}

	let usage = undefined;

	if (RESUME_ID) {
		try {
			const published = await Promise.race([
				ctx.agentLoop.resume(ctx, {
					resumeSessionId: RESUME_ID,
					agentOptions: { provider: currentProvider, model: currentModel },
				}),
				new Promise((_, rej) => setTimeout(() => rej(new Error("resume timed out after 10s")), 10000)),
			]);
			agent = published.agent;
		} catch (err) {
			console.error("[resume] FAILED:", err?.stack ?? String(err));
			process.exit(1);
		}
	} else {
		agent = makeAgent(currentModel, currentProvider);
	}

	const statusLine = () =>
		`dsh-mini · ${currentProvider}/${currentModel} · ${agent.session.id}${usage ? ` · ↑${usage.inputTokens ?? 0} ↓${usage.outputTokens ?? 0}` : ""}`;

	if (ui) {
		ui.setStatus(statusLine());
	} else {
		console.log(`dsh-mini — DSH core + ${currentProvider}/${currentModel} (${PROVIDER_DEFAULTS[currentProvider]?.keyEnv ?? "env key"})`);
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
			if (trimmed.startsWith("/provider ")) {
				const next = trimmed.slice(10).trim();
				if (next && PROVIDER_DEFAULTS[next]) {
					agent.cancel({ kind: "user-provider-switch" });
					currentProvider = next;
					currentModel = PROVIDER_DEFAULTS[next].model;
					agent = makeAgent(currentModel, currentProvider);
					if (ui) ui.setStatus(statusLine());
					else console.log(`(switched to ${next}, new session: ${agent.session.id})`);
				} else {
					const row = "providers: " + Object.keys(PROVIDER_DEFAULTS).join(", ");
					if (ui) ui.addToolResult(row, false);
					else console.log(row);
				}
				return;
			}
			if (trimmed === "/clear") {
				agent.cancel({ kind: "user-clear" });
				agent = makeAgent(currentModel, currentProvider);
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
					agent = makeAgent(next, currentProvider);
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
			if (stdinClosed) process.exit(0);
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
			console.error("[debug] header.tools:", JSON.stringify(event.data?.header?.tools ?? null).slice(0, 200));
			console.error("[debug] header.system:", String(event.data?.header?.system ?? "").slice(0, 5000));
		}
		try {
			renderEvent(event);
		} catch {
			// rendering must never break the loop
		}
	});

	// ---- plain-mode REPL (pi-tui drives its own input) ----

	if (!ui) {
		const ask = async () => {
			for (;;) {
				const line = await askUser("you> ");
				await handleLine(line);
				process.stdout.write("\n");
			}
		};
		void ask();
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
mount("llm-deepseek", deepseekLlm);
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
