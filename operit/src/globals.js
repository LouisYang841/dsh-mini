// Defensive globals for the Operit QuickJS runtime. Pure-JS fallbacks only:
// nothing here shadows a real host API (guarded by typeof checks).

if (typeof globalThis.process === "undefined") {
	globalThis.process = {
		env: {},
		platform: "quickjs",
		versions: { node: "0" },
		cwd: () => "/",
		exit: (code) => {
			throw new Error(`process.exit(${code})`);
		},
	};
}
if (typeof globalThis.console === "undefined") {
	globalThis.console = {
		log() {},
		info() {},
		warn() {},
		error() {},
		debug() {},
	};
}
