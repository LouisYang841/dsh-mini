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
import * as commandsNs from "@deepseek-ai/dsh-commands";
import * as userQuestionsNs from "@deepseek-ai/dsh-user-questions";
import * as tokenMeterNs from "@deepseek-ai/dsh-token-meter";
import * as toolAskUserNs from "@deepseek-ai/dsh-tool-ask-user";
import * as piAiNs from "@deepseek-ai/dsh-llm-pi-ai";
import * as toolSkillNs from "@deepseek-ai/dsh-tool-skill";
import { defineFilesystemSkillProvider } from "./skill-scanner.js";
import * as compactionNs from "@deepseek-ai/dsh-compaction-basic";
import * as sessionTitleNs from "@deepseek-ai/dsh-session-title";
import * as sessionTitleLlmNs from "@deepseek-ai/dsh-session-title-first-prompt-llm";
import * as goalNs from "@deepseek-ai/dsh-goal";
import * as toolGoalNs from "@deepseek-ai/dsh-tool-goal";
import * as goalRoundDriverNs from "@deepseek-ai/dsh-goal-round-driver";
import * as planModeNs from "@deepseek-ai/dsh-plan-mode";
import * as ccTuiNs from "@openguardrails/dsh-tui";
import * as ccTuiPromptNs from "@openguardrails/dsh-tui/prompt";
import * as skillNs from "@deepseek-ai/dsh-skill";
import * as sessionRefNs from "@deepseek-ai/dsh-session-reference";
import * as sessionQueryNs from "@deepseek-ai/dsh-session-query-sqlite";
import * as projectionNs from "@deepseek-ai/dsh-session-projection";
import * as projectionCacheNs from "@deepseek-ai/dsh-session-projection-cache";
import * as storageNs from "@deepseek-ai/dsh-storage";
import * as storageJsonNs from "@deepseek-ai/dsh-storage-json";
import * as storageDomainNs from "@deepseek-ai/dsh-storage-domain";
import { GeminiAdapter } from "./gemini-adapter.js";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { createTuiHost } from "./tui-renderer.js";
import { parseArgs, PROVIDER_DEFAULTS } from "./args.js";
import { loadEnvFiles, persistCredential } from "./env.js";
import { renderBanner } from "./banner.js";
import { defineBashTool, bashGuidanceSection } from "./bash-tool.js";
import * as readline from "node:readline";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
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
// Renderer modes: default = the community pi-tui-based full-screen TUI
// (@openguardrails/dsh-tui); DSH_TUI=basic = our minimal chat-flow shell;
// DSH_PLAIN=1 or non-TTY = plain line mode.
const USE_CC_TUI = TTY && process.env.DSH_TUI !== "basic" && !process.env.DSH_PLAIN;

// CLI args: node cli.mjs [model] [--provider <id>] [--resume <id>] [--sessions]
const {
	model: MODEL,
	provider: PROVIDER,
	resumeId: RESUME_ID,
	listSessions: LIST_SESSIONS,
} = parseArgs(process.argv.slice(2), process.env);

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
loadEnvFiles([join(homedir(), ".dsh-mini", "env"), join(CWD, ".env")], process.env);

// Persist an interactively entered key: user config dir first, cwd .env
// fallback (both gitignored; never touch the repo's tracked files).
function persistCredentialImpl(provider, key) {
	const env = PROVIDER_DEFAULTS[provider].keyEnv;
	const written = persistCredential(
		[join(homedir(), ".dsh-mini", "env"), join(CWD, ".env")],
		env,
		key,
	);
	if (written) {
		console.log(`(saved ${env} to ${written})`);
		return;
	}
	console.error(`[warn] could not persist ${env}; it is set for this session only`);
}

const AGENTS_MD_CAP = 30 * 1024; // keep injected instructions bounded

const boot = async (ctx) => {
	if (TTY && !process.env.DSH_NO_BANNER) process.stdout.write(renderBanner());
	if (GEMINI_KEY) ctx.llm.registerAdapter(["google"], new GeminiAdapter(GEMINI_KEY));
	// /new: available in every renderer. In the community TUI it restarts the
	// process with a fresh session id; plain mode handles it in handleLine.
	ctx.commands.register({
		name: "goal",
		description: "Show the active same-session goal (objective, phase, rounds)",
		handler: async () => {
			const goal = agent ? ctx.goals.get(agent) : void 0;
			const text = goal
				? `goal: ${goal.objective} (${goal.phase}, round ${goal.roundsStarted ?? 0}/${goal.maxGoalRounds ?? "?"})`
				: "no active goal";
			return { kind: "success", text };
		},
	});
	ctx.commands.register({
		name: "new",
		description: "Start a fresh session (restarts with a new session id)",
		handler: async (invocation) => {
			try {
				ctx.emit("session/flush", invocation.agent.session);
			} catch {
				// best-effort flush before restart
			}
			spawn(process.execPath, [process.argv[1]], {
				detached: true,
				stdio: "inherit",
				env: { ...process.env, DSH_FRESH: "1" },
			}).unref();
			setTimeout(() => process.exit(0), 300);
			return { kind: "success", text: "starting a fresh session" };
		},
	});
	if (process.env.DSH_DEBUG) {
		console.error("[debug] registered adapters:", [...ctx.llm.adapters.keys()].join(","));
		setTimeout(() => {
			if (agent) console.error("[debug] commands:", ctx.commands.list(agent).map((c) => c.name).join(","));
		}, 2000);
	}
	ctx.tools.register(defineBashTool());
	ctx.systemPrompt.section(bashGuidanceSection());
	ctx.skills.registerProvider(() =>
		defineFilesystemSkillProvider([join(CWD, "skills"), join(homedir(), ".dsh-mini", "skills")]),
	);
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

	const makeAgent = (model, provider = PROVIDER, id = `cli-${Date.now().toString(36)}`) => {
		return ctx.agentLoop.create(id, { provider, model }, { cwd: CWD });
	};

	let agent = null;
	let busy = false;

	// ---- renderer first: interactive setup needs it before the agent exists ----
	const ui = TTY && !USE_CC_TUI
		? createTuiHost({
				onLine: (line) => void handleLine(line),
				onInterrupt: () => {
					if (busy && agent) agent.cancel({ kind: "user-interrupt" });
				},
			})
		: null;

	let plainRl = null;
	let stdinClosed = false;
	let plainInputActive = false;
	// Piped stdin delivers whole chunks at once, so rl.question misses lines
	// that arrive before the next question is registered. A persistent
	// listener + queue fixes it: early lines queue, askUser drains the queue.
	let lineQueue = [];
	let lineResolver = null;
	if (!TTY) {
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
			if (!plainInputActive) return;
			stdinClosed = true;
			if (!busy) gracefulExit();
		});
	}
	const askUser = (question) => {
		process.stdout.write(question);
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
			const answer = (await askUser(`provider (${Object.keys(PROVIDER_DEFAULTS).join("/")}) [deepseek-official]: `)).trim() || "deepseek-official";
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
			persistCredentialImpl(answer, key);
		}
	}

	let usage = undefined;

	// TTY mode with DSH_CC_TUI=1: mount the pi-tui-based
	// @openguardrails/dsh-tui BEFORE the agent exists so its agent/created
	// listener is armed, then create the agent it watches. EXPERIMENTAL:
	// the UI mounts and renders, but piped-input submission is unverified —
	// test interactively on a real terminal.
	if (USE_CC_TUI) {
		if (plainRl) {
			plainInputActive = false;
			plainRl.close();
			plainRl = null;
		}
		const tuiSessionId = RESUME_ID ?? (process.env.DSH_FRESH ? `main-${Date.now().toString(36)}` : "main");
		ctx.plugin(ccTuiNs, {
			sessionId: tuiSessionId,
			welcome: "dsh-mini — DeepSeek Harness 便携核心 · pi 壳 · DSH 引擎",
			title: "dsh-mini · DeepSeek Harness",
		}).then(
			() => {},
			(err) => {
				console.error("[cc-tui] mount FAILED:", err?.stack ?? String(err));
				process.exit(1);
			},
		);
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
		} else if (tuiSessionId === "main" && !process.env.DSH_FRESH) {
			// The "main" session id is fixed across TUI runs: resume the
			// persisted log instead of minting a fresh session with the same
			// id. A fresh agent would carry a new header (createdAt, seed),
			// which trips session-query's source-header consistency check on
			// every /resume scan. Resuming also keeps context continuity.
			try {
				const published = await Promise.race([
					ctx.agentLoop.resume(ctx, {
						resumeSessionId: "main",
						agentOptions: { provider: currentProvider, model: currentModel },
					}),
					new Promise((_, rej) => setTimeout(() => rej(new Error("resume timed out after 10s")), 10000)),
				]);
				agent = published.agent;
			} catch (err) {
				// No persisted "main" yet (or it is unreadable): first run.
				if (!/not found/i.test(String(err))) {
					console.error("[resume-main] FAILED, starting fresh:", err?.stack ?? String(err));
				}
				agent = makeAgent(currentModel, currentProvider, "main");
			}
		} else {
			agent = makeAgent(currentModel, currentProvider, tuiSessionId);
		}
		return;
	}

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
		console.log("commands: /new  /resume [id]  /clear  /model [id]  /provider [id]  /sessions  /stats  /exit");
		console.log("");
	}

	// ---- shared input handling ----

	// Exit with a persistence flush grace: the JSONL backend writes in
	// 200ms batches; an immediate process.exit() kills the pending write.
	const gracefulExit = () => {
		try {
			if (agent) ctx.emit("session/flush", agent.session);
		} catch {
			// flush is best-effort on the way out
		}
		setTimeout(() => process.exit(0), 500);
	};

	async function handleLine(line) {
		const trimmed = line.trim();
		try {
			if (/^(\/)?(exit|quit|e|q)(\(\))?$/i.test(trimmed)) {
				gracefulExit();
			}
			if (trimmed === "") return;
			if (trimmed === "/provider") {
				const row = "providers: " + Object.keys(PROVIDER_DEFAULTS).join(", ") + "\n/model <id> switches models; set the provider's env key to enable its route";
				if (ui) ui.addToolResult(row, false);
				else console.log(row);
				return;
			}
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
			if (trimmed === "/clear" || trimmed === "/new") {
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
			if (trimmed === "/goal") {
				const goal = agent ? ctx.goals.get(agent) : void 0;
				const row = goal
					? `goal: ${goal.objective} (${goal.phase}, round ${goal.roundsStarted ?? 0}/${goal.maxGoalRounds ?? "?"})`
					: "no active goal";
				if (ui) ui.addToolResult(row, false);
				else console.log(row);
				return;
			}
			if (trimmed === "/resume") {
				const headers = await ctx.sessionPersistence.list();
				for (const header of headers) {
					const row = `${header.id}\t${header.cwd ?? ""}\t${header.createdAt ?? ""}\t${header.eventCount ?? ""}`;
					if (ui) ui.addToolResult(row, false);
					else console.log(row);
				}
				const hint = "usage: /resume <id>";
				if (ui) ui.addToolResult(hint, false);
				else console.log(hint);
				return;
			}
			if (trimmed.startsWith("/resume ")) {
				const id = trimmed.slice(8).trim();
				if (!id) return;
				try {
					agent.cancel({ kind: "user-resume" });
					const published = await Promise.race([
						ctx.agentLoop.resume(ctx, {
							resumeSessionId: id,
							agentOptions: { provider: currentProvider, model: currentModel },
						}),
						new Promise((_, rej) => setTimeout(() => rej(new Error("resume timed out after 10s")), 10000)),
					]);
					agent = published.agent;
					if (ui) ui.setStatus(statusLine());
					else console.log(`(resumed ${id})`);
				} catch (err) {
					const row = `[resume] FAILED: ${err?.message ?? String(err)}`;
					if (ui) ui.addError(row);
					else console.error(row);
				}
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
			if (trimmed === "/model") {
				const row = "usage: /model <id>   (current: " + currentModel + ")";
				if (ui) ui.addToolResult(row, false);
				else console.log(row);
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
			if (stdinClosed) gracefulExit();
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

	plainInputActive = true;
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
boot.inject = ["agents", "sessions", "llm", "tools", "systemPrompt", "agentLoop", "sessionPersistence", "skills", "commands", "goals"];

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
mount("llm-pi-ai", piAiNs, {
	providers: {
		deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY" },
		...(process.env.OPENAI_API_KEY ? { openai: { apiKeyEnv: "OPENAI_API_KEY" } } : {}),
		...(process.env.ANTHROPIC_API_KEY ? { anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" } } : {}),
		...(process.env.OPENROUTER_API_KEY ? { openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" } } : {}),
	},
});
mount("commands", commandsNs.CommandRuntime);
mount("user-questions", userQuestionsNs.UserQuestionService);
mount("token-meter", tokenMeterNs.TokenMeter);
mount("tool-ask-user", toolAskUserNs);
mount("skills", skillNs.SkillRegistry);
mount("session-reference", sessionRefNs.default);
mount("session-query", sessionQueryNs.default, { path: join(dirname(SESSIONS_DIR), "session-query.sqlite") });
mount("session-projection", projectionNs.SessionProjectionRegistry);
mount("session-projection-cache", projectionCacheNs.SessionProjectionCache);
mount("storage", storageNs.Storage);
mount("storage-json", storageJsonNs);
mount("storage-domain", storageDomainNs);
mount("tui-prompt", ccTuiPromptNs.TuiPromptService);
mount("tool-skill", toolSkillNs);
mount("goals", goalNs.GoalService);
mount("tool-goal", toolGoalNs);
mount("goal-round-driver", goalRoundDriverNs);
mount("plan-mode", planModeNs.PlanModeController);
mount("compaction", compactionNs.BasicCompactionEngine, {
	auto: true,
	thresholdRatio: Number(process.env.DSH_COMPACT_RATIO ?? 0.8),
});
// Titles cost one silent LLM call per session: opt-in via DSH_TITLES, or
// auto-enabled with the community TUI (its session list expects them).
if (process.env.DSH_TITLES || USE_CC_TUI) {
	mount("session-title", sessionTitleNs.SessionTitleService);
	mount("session-title-llm", sessionTitleLlmNs);
}
mount("fs", LocalFileSystem, { cwd: CWD });
mount("persistence", persistenceJsonl.JsonlSessionPersistence, { root: SESSIONS_DIR, ...(HAS_ZSTD ? {} : { compression: "none" }) });
mount("tool-fs", fsTools);
mount("tool-todo", todoTools, { allowParallelInProgress: true });
mount("agentLoop", AgentLoop, { maxParallelToolCalls: 4 });
root.plugin(boot).then(
	() => {},
	(err) => {
		console.error("dsh-mini failed to boot:", err?.stack ?? String(err));
		process.exit(1);
	},
);
