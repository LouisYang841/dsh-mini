// node:timers shim — microtask-based approximation.
// The core loop must not depend on timer DURATIONS (timeouts live in
// dsh-timeout, which is not part of the core bundle). All callbacks fire on
// the next microtask drain, in registration order.
let nextId = 1;
const pending = new Map();

function schedule(fn, args) {
	const id = nextId++;
	pending.set(id, { fn, args });
	Promise.resolve().then(() => {
		if (pending.has(id)) {
			pending.delete(id);
			try {
				fn(...args);
			} catch (e) {
				if (typeof printErr === "function") printErr("timer callback threw: " + e);
			}
		}
	});
	return id;
}

export function setTimeout(fn, ms, ...args) {
	return schedule(fn, args);
}
export function setInterval(fn, ms, ...args) {
	return schedule(fn, args); // fire once; acceptable for spike
}
export function clearTimeout(id) {
	pending.delete(id);
}
export const clearInterval = clearTimeout;
export function setImmediate(fn, ...args) {
	return schedule(fn, args);
}
export const clearImmediate = clearTimeout;
export default { setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, clearImmediate };
