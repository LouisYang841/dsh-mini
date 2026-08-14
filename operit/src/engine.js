// DSH engine boot for Operit: the same known-good mount list as cli/cli.js,
// minus everything that needs Node or the desktop TUI. Tools here are the
// Operit tentacles (toolCall globals); the engine itself is untouched.

import "../../polyfills.js";
import "./globals.js";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { LlmRuntime, LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import * as todoTools from "@deepseek-ai/dsh-tool-todo";
import { DeepSeekAdapter } from "./llm-adapter.js";
import { defineExecTool } from "./tools.js";
import { loadSessionEvents, sessionLogPath } from "./store.js";

let booted = null; // { ctx, agent, configKey }

export function isBooted() {
	return booted !== null;
}

export function currentEngine() {
	return booted;
}

/** Engine self-test adapter: scripted todo_write call, zero network. */
class SelfTestAdapter extends LlmAdapter {
	providerInfo(provider) {
		return { id: provider, name: "selftest" };
	}
	resolveModel(provider, model) {
		return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100000 } });
	}
	stream() {
		const todos = JSON.stringify({ todos: [{ content: "operit self-test", status: "pending" }] });
		const chunks = (globalThis.__SELF_TEST_STEP = (globalThis.__SELF_TEST_STEP ?? 0) + 1) === 1
			? [
					{ type: "block-start", index: 0, blockType: "tool-call" },
					{ type: "tool-call-delta", index: 0, id: "self-0", name: "todo_write", argumentsDelta: todos },
					{ type: "block-end", index: 0, block: { type: "tool-call", id: "self-0", name: "todo_write", arguments: todos } },
					{ type: "finish", reason: { kind: "stop" } },
				]
			: [
					{ type: "block-start", index: 0, blockType: "text" },
					{ type: "text-delta", index: 0, text: "self-test ok" },
					{ type: "block-end", index: 0, block: { type: "text", text: "self-test ok" } },
					{ type: "finish", reason: { kind: "stop" } },
				];
		let i = 0;
		return {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						return i < chunks.length ? { value: chunks[i++], done: false } : { done: true };
					},
				};
			},
		};
	}
}

/**
 * Boot one engine instance with the given adapter factory. Shared by
 * bootDsh (real DeepSeek) and selfTest (scripted adapter) so the self-test
 * exercises the exact same mount list as production.
 */
async function createEngine(config, adapterFactory, agentId) {
	const engine = { ctx: new Context(), agent: null, config, configKey: `${config.apiKey.slice(-6)}:${config.modelName}:${agentId}` };
	const boot = async (ctx) => {
		const adapter = adapterFactory();
		ctx.llm.registerAdapter(["deepseek"], adapter);
		ctx.tools.register(defineExecTool());
		// create() returns the agent object directly (see cli/cli.js makeAgent).
		engine.agent = ctx.agentLoop.create(agentId, { provider: "deepseek", model: config.modelName }, { cwd: "/" });
		if (agentId === "operit-main") {
			// Best-effort: surface the persisted log for diagnostics (full
			// resume continuity needs the SessionPersistence contract — README).
			loadSessionEvents().then(
				(events) => {
					engine.persisted = { path: sessionLogPath(), events: events.length };
					if (typeof console !== "undefined" && console.log) {
						console.log(`[dshmini] persisted log: ${events.length} events at ${sessionLogPath()}`);
					}
				},
				() => {
					engine.persisted = { path: sessionLogPath(), events: 0 };
				},
			);
		}
	};
	boot.inject = ["agents", "sessions", "llm", "tools", "systemPrompt", "agentLoop"];

	const root = engine.ctx;
	const mount = (label, plugin, configArg) => {
		root.plugin(plugin, configArg).then(
			() => {},
			(err) => {
				if (typeof console !== "undefined" && console.error) {
					console.error(`[dshmini] ${label} mount FAILED:`, err?.stack ?? String(err));
				}
			},
		);
	};
	mount("agents", AgentRegistry);
	mount("sessions", SessionStore);
	mount("systemPrompt", SystemPrompt, {
		persona: "You are DSH mini — a DeepSeek Harness coding agent running inside Operit on an Android phone. You can execute commands through the phone's terminal and filesystem via your tools.",
		includeHarnessIdentity: true,
		includeRuntimeContext: false,
	});
	mount("tools", ToolRuntime, { mode: "native" });
	mount("llm", LlmRuntime);
	mount("tool-todo", todoTools, { allowParallelInProgress: true });
	mount("agentLoop", AgentLoop, { maxParallelToolCalls: 4 });
	root.plugin(boot).then(
		() => {},
		(err) => {
			if (typeof console !== "undefined" && console.error) {
				console.error("[dshmini] boot FAILED:", err?.stack ?? String(err));
			}
		},
	);
	await waitEngineAgent(engine);
	return engine;
}

/** Boot (once per apiKey+model) the DSH context and its agent. */
export async function bootDsh(config) {
	const configKey = `${config.apiKey.slice(-6)}:${config.modelName}`;
	if (booted && booted.configKey === configKey) {
		if (!booted.agent) await waitEngineAgent(booted);
		return booted;
	}
	// A new config: replace the running engine (dispose the old context).
	if (booted) {
		try {
			booted.ctx.dispose();
		} catch {
			// best-effort
		}
		booted = null;
	}
	booted = await createEngine(
		config,
		() => {
			// __DSH_FAKE_ADAPTER (tests only) injects a scripted adapter instead
			// of the DeepSeek transport — the fake-provider replay trick.
			if (typeof globalThis.__DSH_FAKE_ADAPTER === "function") {
				const fake = globalThis.__DSH_FAKE_ADAPTER(config);
				if (fake) return fake;
			}
			return new DeepSeekAdapter(config);
		},
		"operit-main",
	);
	return booted;
}

/**
 * On-device self-test: boot a THROWAWAY engine with the scripted adapter
 * and run one full turn, asserting the todo tool dispatched. Proves the
 * engine + turn machine + tool scheduler are alive on this runtime without
 * spending a real API call. Disposes its context before returning.
 */
export async function selfTest(config) {
	const started = Date.now();
	let engine;
	try {
		engine = await createEngine(config, () => new SelfTestAdapter(), "operit-selftest");
		globalThis.__SELF_TEST_STEP = 0;
		const message = createUserMessage({
			content: [{ type: "text", text: "self-test" }],
			source: { kind: "user" },
		});
		engine.agent.followup(message);
		await engine.agent.whenIdle();
		const todoWrites = engine.agent.session.events.filter((e) => e.type === "todo/write").length;
		const events = engine.agent.session.events.length;
		const ok = todoWrites === 1;
		return {
			ok,
			events,
			todoWrites,
			elapsedMs: Date.now() - started,
			message: ok
				? `engine self-test passed: full turn ran (${events} events, todo tool dispatched)`
				: `engine self-test failed: todo tool did not dispatch (${events} events)`,
		};
	} catch (error) {
		return {
			ok: false,
			events: 0,
			todoWrites: 0,
			elapsedMs: Date.now() - started,
			message: `engine self-test failed: ${String(error?.message || error)}`,
		};
	} finally {
		if (engine) {
			try {
				engine.ctx.dispose();
			} catch {
				// best-effort
			}
		}
	}
}

async function waitEngineAgent(engine, timeoutMs = 20000) {
	const started = Date.now();
	while (engine && !engine.agent) {
		if (Date.now() - started > timeoutMs) {
			throw new Error("DSH engine agent did not start within 20s");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
