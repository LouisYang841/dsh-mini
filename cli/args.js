// CLI argument parsing — pure function, extracted from cli.js for testability.
// Behavior is identical to the inline code that used to live in cli.js;
// this module has no side effects and imports nothing from the DSH tree.

export const PROVIDER_DEFAULTS = {
	"deepseek-official": { model: "deepseek-v4-flash", keyEnv: "DEEPSEEK_API_KEY" },
	google: { model: "gemini-flash-latest", keyEnv: "GEMINI_API_KEY" },
	// pi-ai routes (the pi provider ecosystem): one adapter, many providers
	deepseek: { model: "deepseek-v4-flash", keyEnv: "DEEPSEEK_API_KEY" },
	openai: { model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
	anthropic: { model: "claude-sonnet-4-5", keyEnv: "ANTHROPIC_API_KEY" },
	openrouter: { model: "openai/gpt-4o-mini", keyEnv: "OPENROUTER_API_KEY" },
};

/**
 * Parse CLI args the same way cli.js did inline.
 * @param {string[]} argv process.argv.slice(2)
 * @param {NodeJS.ProcessEnv} env for provider resolution (DSH_PROVIDER, DEEPSEEK_API_KEY, GEMINI_API_KEY)
 */
export function parseArgs(argv, env = process.env) {
	const positional = argv.filter((a) => !a.startsWith("--"));
	const resumeIndex = argv.indexOf("--resume");
	const providerIndex = argv.indexOf("--provider");
	const providerOverride = providerIndex >= 0 ? argv[providerIndex + 1] : undefined;
	const provider =
		providerOverride ??
		env.DSH_PROVIDER ??
		(env.DEEPSEEK_API_KEY || !env.GEMINI_API_KEY ? "deepseek-official" : "google");
	const model = positional[0] ?? PROVIDER_DEFAULTS[provider]?.model ?? "deepseek-v4-flash";
	return {
		model,
		provider,
		providerOverride,
		resumeId: resumeIndex >= 0 ? argv[resumeIndex + 1] : undefined,
		listSessions: argv.includes("--sessions"),
	};
}
