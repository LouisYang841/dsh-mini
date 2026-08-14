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
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import * as todoTools from "@deepseek-ai/dsh-tool-todo";
import { DeepSeekAdapter } from "./llm-adapter.js";
import { defineExecTool } from "./tools.js";

let booted = null; // { ctx, agent, configKey }

export function isBooted() {
	return booted !== null;
}

export function currentEngine() {
	return booted;
}

const boot = async (ctx) => {
	// __DSH_FAKE_ADAPTER (tests only) injects a scripted adapter instead of
	// the DeepSeek transport — the fake-provider replay trick from main.js.
	const adapter =
		typeof globalThis.__DSH_FAKE_ADAPTER === "function"
			? globalThis.__DSH_FAKE_ADAPTER(booted.config)
			: new DeepSeekAdapter(booted.config);
	ctx.llm.registerAdapter(["deepseek"], adapter);
	ctx.tools.register(defineExecTool());
	// create() returns the agent object directly (see cli/cli.js makeAgent).
	booted.agent = ctx.agentLoop.create("operit-main", { provider: "deepseek", model: booted.config.modelName }, { cwd: "/" });
};
boot.inject = ["agents", "sessions", "llm", "tools", "systemPrompt", "agentLoop"];

/** Boot (once per apiKey+model) the DSH context and its agent. */
export async function bootDsh(config) {
	const configKey = `${config.apiKey.slice(-6)}:${config.modelName}`;
	if (booted && booted.configKey === configKey) {
		if (!booted.agent) await waitAgent();
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
	booted = { ctx: new Context(), agent: null, config, configKey };
	const root = booted.ctx;
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
	await waitAgent();
	return booted;
}

async function waitAgent(timeoutMs = 20000) {
	const started = Date.now();
	while (booted && !booted.agent) {
		if (Date.now() - started > timeoutMs) {
			throw new Error("DSH engine agent did not start within 20s");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
