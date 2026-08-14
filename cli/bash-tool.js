// bash tool for the DSH core, built on pi's native bash executor.
// The execution core (streaming, sanitization, truncation, temp-file spill,
// abort handling) is vendored verbatim from @earendil-works/pi coding-agent
// (vendor-pi/bash-executor.ts, MIT). Only the local platform glue
// (child_process.spawn process-group kill) is reimplemented here, following
// pi's createLocalBashOperations design. No DSH shell/sandbox packages.
import { spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { executeBashWithOperations } from "../vendor-pi/bash-executor.ts";

function killProcessTree(pid) {
	try {
		// detached: true puts the child in its own process group
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
}

/** Local BashOperations: pi's design, minimal platform glue. */
const localBashOperations = {
	exec: async (command, cwd, { onData, signal, timeout, env }) => {
		if (signal?.aborted) throw new Error("aborted");
		const child = spawn("bash", ["-c", command], {
			cwd,
			detached: process.platform !== "win32",
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let timedOut = false;
		let timeoutHandle;
		const onAbort = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		try {
			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					if (child.pid) killProcessTree(child.pid);
				}, timeout);
			}
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);
			if (signal) {
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}
			const exitCode = await new Promise((resolve) => {
				child.on("error", () => resolve(null));
				child.on("close", (code) => resolve(code));
			});
			if (signal?.aborted) throw new Error("aborted");
			if (timedOut) throw new Error(`timeout:${timeout}`);
			return { exitCode };
		} finally {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			signal?.removeEventListener("abort", onAbort);
		}
	},
};

function renderBashResult(value) {
	const lines = [];
	if (value.output) lines.push(value.output);
	lines.push(
		`[exit code: ${value.exitCode === null ? "killed" : value.exitCode}${value.cancelled ? ", cancelled" : ""}${value.truncated ? ", truncated" : ""}${value.fullOutputPath ? `, full output: ${value.fullOutputPath}` : ""}]`,
	);
	return [{ type: "text", text: lines.join("\n").slice(0, 30000) }];
}

/** The DSH tool definition wrapping pi's executor. */
export function defineBashTool() {
	return defineTool({
		name: "bash",
		description:
			"Execute a bash command in the workspace and return sanitized output (stdout+stderr). Output over 50KB is truncated with the tail kept; long-running commands should pass timeoutMs. Prefer the read/edit/write tools over shell commands for file inspection.",
		parameters: {
			command: { type: "string", required: true, description: "The bash command to run." },
			description: { type: "string", required: true, description: "One sentence describing what this command does." },
			timeoutMs: { type: "number", description: "Optional timeout in milliseconds; the process tree is killed on expiry." },
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					output: { type: "string", required: true },
					exitCode: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
					cancelled: { type: "boolean", required: true },
					truncated: { type: "boolean", required: true },
					fullOutputPath: { type: "string" },
				},
			},
			render: (_args, value) => renderBashResult(value),
		},
		async execute(args, exec) {
			const cwd = exec.agent?.session.header.cwd ?? process.cwd();
			const result = await executeBashWithOperations(args.command, cwd, localBashOperations, {
				signal: exec.signal,
				timeout: args.timeoutMs,
			});
			// The DTO must be JSON-lossless: undefined fields fail snapshot.
			return {
				output: result.output,
				exitCode: result.exitCode,
				cancelled: result.cancelled,
				truncated: result.truncated,
				...(result.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}),
			};
		},
	});
}

/** Prompt guidance so the model treats bash as a last resort, not a reflex. */
export function bashGuidanceSection() {
	return {
		name: "tools:bash",
		order: 110,
		text: "The bash tool runs commands with the user's permissions inside the workspace directory. Use it for builds, tests, and git; prefer the read/edit/write tools for plain file work, and always pass timeoutMs for long-running commands.",
	};
}
