// DSH tool over Operit's tentacles: everything routes through the
// global toolCall({ name, params, options }) bridge.
//
// Operit tool names live in its Kotlin tool registry; adjust this map on
// device if a name differs (the mocks use the same names, so Node-side
// verification stays consistent with whatever we set here).

import { defineTool } from "@deepseek-ai/dsh-tools";

export const OPERIT_TOOL_NAMES = {
	// StandardShellToolExecutor — the phone's terminal/shell.
	exec: "shell_exec",
};

function norm(value) {
	return value == null ? "" : String(value);
}

/** Extract text from Operit's tool result envelope (shapes vary per tool). */
function resultText(result) {
	if (result == null) return "(no output)";
	if (typeof result === "string") return result;
	for (const key of ["result", "content", "output", "data", "text"]) {
		const v = result[key];
		if (v == null) continue;
		if (typeof v === "string") return v;
		try {
			return JSON.stringify(v);
		} catch {
			return norm(v);
		}
	}
	try {
		return JSON.stringify(result);
	} catch {
		return norm(result);
	}
}

export function defineExecTool() {
	return defineTool({
		name: "exec",
		description:
			"Execute a shell command in the phone's terminal and return the combined output (stdout+stderr). Use it for anything the read/write tools do not cover; pass timeoutMs for long-running commands.",
		parameters: {
			command: { type: "string", required: true, description: "The shell command to run." },
			timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					output: { type: "string", required: true },
					success: { type: "boolean", required: true },
				},
			},
			render: (_args, value) => value.output,
		},
		async execute(args, exec) {
			let result;
			try {
				result = await toolCall({
					name: OPERIT_TOOL_NAMES.exec,
					params: {
						command: args.command,
						...(args.timeoutMs !== undefined ? { timeout_ms: args.timeoutMs } : {}),
					},
				});
			} catch (error) {
				return { output: `exec failed: ${norm(error?.message || error)}`, success: false };
			}
			if (result && typeof result === "object" && (result.success === false || result.isError === true)) {
				return { output: norm(result.error || result.message || "command failed"), success: false };
			}
			return { output: resultText(result), success: true };
		},
	});
}
