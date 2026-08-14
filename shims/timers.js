// node:timers shim — microtask-based approximation.
// The core loop must not depend on timer DURATIONS (timeouts live in
// dsh-timeout, which is not part of the core bundle). Callbacks fire on the
// next microtask drain, in registration order. setInterval keeps firing until
// clearInterval cancels it, matching the Node contract for hosts without real
// timers.
let nextId = 1;
const pending = new Map();

function scheduleOnce(fn, args) {
const id = nextId++;
pending.set(id, { fn, args, repeating: false });
Promise.resolve().then(() => run(id));
return id;
}

function scheduleRepeating(fn, args) {
const id = nextId++;
pending.set(id, { fn, args, repeating: true });
Promise.resolve().then(() => run(id));
return id;
}

function run(id) {
const entry = pending.get(id);
if (entry === undefined) return;
if (!entry.repeating) pending.delete(id);
try {
entry.fn(...entry.args);
} finally {
if (entry.repeating && pending.has(id)) Promise.resolve().then(() => run(id));
}
}

export function setTimeout(fn, ms, ...args) {
return scheduleOnce(fn, args);
}
export function setInterval(fn, ms, ...args) {
return scheduleRepeating(fn, args);
}
export function clearTimeout(id) {
pending.delete(id);
}
export const clearInterval = clearTimeout;
export function setImmediate(fn, ...args) {
return scheduleOnce(fn, args);
}
export const clearImmediate = clearTimeout;
export default { setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, clearImmediate };
