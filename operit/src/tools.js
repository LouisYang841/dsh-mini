// DSH tool over Operit's tentacles: everything routes through the
// global toolCall({ name, params, options }) bridge.
//
// Tool names/params below come from Operit's authoritative registry
// (app/src/main/assets/packages/super_admin.js):
//   terminal  — run commands in the app's Ubuntu (proot) environment with
//               sdcard/storage mounted; session-persistent cwd; params:
//               command (required), background ("true"/"false"),
//               timeoutMs (STRING, min 3000; foreground default 15s).
//   shell     — direct Android shell via Shizuku/Root (pm/am level).

import { defineTool } from "@deepseek-ai/dsh-tools";

export const OPERIT_TOOL_NAMES = {
	exec: "terminal",
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
			"Execute a shell command in Operit's Ubuntu terminal (sdcard/storage mounted, persistent working directory) and return the combined output. Prefer read/write tools for plain file work; always pass timeoutMs for long-running commands (minimum 3000).",
		parameters: {
			command: { type: "string", required: true, description: "The shell command to run." },
			timeoutMs: { type: "number", description: "Optional timeout in milliseconds (minimum 3000; default 15000)." },
			background: { type: "boolean", description: "Run in background and return immediately (no output captured)." },
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
						...(args.background === true ? { background: "true" } : {}),
						...(args.timeoutMs !== undefined
							? { timeoutMs: String(Math.max(3000, Math.floor(args.timeoutMs))) }
							: {}),
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
