// Pure CLI-argument parsing, extracted from cli.js for testability.
// Behavior is IDENTICAL to the original inline logic — do not "improve" it here.

export function parseArgs(argv, env, providerDefaults) {
	const args = argv.filter((a) => !a.startsWith("--"));
	const resumeIndex = argv.indexOf("--resume");
	const resumeId = resumeIndex >= 0 ? argv[resumeIndex + 1] : undefined;
	const providerIndex = argv.indexOf("--provider");
	const providerOverride = providerIndex >= 0 ? argv[providerIndex + 1] : undefined;
	const listSessions = argv.includes("--sessions");
	const provider =
		providerOverride ??
		env.DSH_PROVIDER ??
		(env.DEEPSEEK_API_KEY || !env.GEMINI_API_KEY ? "deepseek-official" : "google");
	const model = args[0] ?? providerDefaults[provider]?.model ?? "deepseek-v4-flash";
	return { model, provider, resumeId, listSessions };
}
