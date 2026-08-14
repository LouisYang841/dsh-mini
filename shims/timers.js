// node:timers shim.
//
// On QuickJS with `qjs --std`, globalThis.os.setTimeout provides real host
// timers and is used for both timeout and interval scheduling so intervals
// yield to the event loop. On bare engines without a host timer, one-shot
// timers degrade to microtasks (the DSH core slice does not depend on timer
// durations); setInterval throws instead of creating an unbounded microtask
// loop that would starve the event loop.
let nextId = 1;
const pending = new Map();
const hostSetTimeout = typeof globalThis.os === "object" && typeof globalThis.os.setTimeout === "function"
? globalThis.os.setTimeout.bind(globalThis.os)
: undefined;
const hostClearTimeout = typeof globalThis.os === "object" && typeof globalThis.os.clearTimeout === "function"
? globalThis.os.clearTimeout.bind(globalThis.os)
: undefined;

function store(id, entry) {
pending.set(id, entry);
return id;
}

function microtaskOnce(fn, args) {
const id = nextId++;
pending.set(id, { fn, args, repeating: false });
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
if (entry.repeating && pending.has(id)) {
if (hostSetTimeout) {
entry.raw = hostSetTimeout(() => run(id), 0);
} else {
Promise.resolve().then(() => run(id));
}
}
}
}

export function setTimeout(fn, ms, ...args) {
if (hostSetTimeout) {
const id = nextId++;
const entry = { fn, args, repeating: false };
entry.raw = hostSetTimeout(() => run(id), Number(ms) || 0);
return store(id, entry);
}
return microtaskOnce(fn, args);
}

export function setInterval(fn, ms, ...args) {
if (hostSetTimeout) {
const id = nextId++;
const entry = { fn, args, repeating: true };
entry.raw = hostSetTimeout(() => run(id), Number(ms) || 0);
return store(id, entry);
}
throw new Error("node:timers shim requires a host timer implementation for setInterval");
}

export function clearTimeout(id) {
const entry = pending.get(id);
if (entry && entry.raw !== undefined && hostClearTimeout) hostClearTimeout(entry.raw);
pending.delete(id);
}
export const clearInterval = clearTimeout;

export function setImmediate(fn, ...args) {
return setTimeout(fn, 0, ...args);
}
export const clearImmediate = clearTimeout;

export default { setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, clearImmediate };
