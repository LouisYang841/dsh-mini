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
// Microtask-based timer globals for runtimes without them (QuickJS); the
// engine core does not depend on timer DURATIONS — callbacks fire on the
// next microtask drain, mirroring shims/timers.js. setInterval fires once.
if (typeof globalThis.setTimeout === "undefined") {
	let nextTimerId = 1;
	const pendingTimers = new Map();
	const scheduleTimer = (fn, args) => {
		const id = nextTimerId++;
		pendingTimers.set(id, { fn, args });
		Promise.resolve().then(() => {
			if (pendingTimers.has(id)) {
				pendingTimers.delete(id);
				try {
					fn(...args);
				} catch (error) {
					if (typeof printErr === "function") printErr(`timer callback threw: ${error}`);
				}
			}
		});
		return id;
	};
	globalThis.setTimeout = (fn, _ms, ...args) => scheduleTimer(fn, args);
	globalThis.setInterval = (fn, _ms, ...args) => scheduleTimer(fn, args);
	globalThis.clearTimeout = (id) => pendingTimers.delete(id);
	globalThis.clearInterval = (id) => pendingTimers.delete(id);
}
