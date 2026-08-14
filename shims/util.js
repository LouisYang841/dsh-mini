// Minimal node:util shim.
import { isPromise } from "./util_types.js";

function inspectInner(v, depth, seen) {
if (v === null) return "null";
if (typeof v === "string") return JSON.stringify(v);
if (typeof v === "number" || typeof v === "boolean" || typeof v === "undefined") return String(v);
if (typeof v === "function") return "[Function]";
if (depth <= 0) return "[...]";
if (seen.has(v)) return "[Circular]";
seen.add(v);
if (Array.isArray(v)) return "[" + v.map((x) => inspectInner(x, depth - 1, seen)).join(", ") + "]";
if (v instanceof Error) return v.name + ": " + v.message;
if (v instanceof Map) return "Map(" + v.size + ")";
if (v instanceof Set) return "Set(" + v.size + ")";
const keys = Object.keys(v);
const body = keys.map((k) => k + ": " + inspectInner(v[k], depth - 1, seen)).join(", ");
return "{" + body + "}";
}

export function inspect(v) {
return inspectInner(v, 3, new Set());
}

export function format(first, ...args) {
if (typeof first !== "string") return [first, ...args].map((a) => (typeof a === "string" ? a : inspect(a))).join(" ");
let out = "";
let argIndex = 0;
for (let i = 0; i < first.length; i++) {
const ch = first[i];
if (ch !== "%") {
out += ch;
continue;
}
const spec = first[i + 1];
i += 1;
const value = args[argIndex++];
if (spec === "s") out += String(value);
else if (spec === "d" || spec === "i") out += String(Number(value));
else if (spec === "j") out += JSON.stringify(value);
else if (spec === "%") out += "%";
else out += "%" + (spec ?? "");
}
for (; argIndex < args.length; argIndex++) out += (out ? " " : "") + (typeof args[argIndex] === "string" ? args[argIndex] : inspect(args[argIndex]));
return out;
}

function deepEqual(a, b, seen) {
if (Object.is(a, b)) return true;
if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
if (seen.has(a)) return seen.get(a) === b;
seen.set(a, b);
const protoA = Object.getPrototypeOf(a);
const protoB = Object.getPrototypeOf(b);
if (protoA !== protoB) return false;
if (a instanceof Date || a instanceof RegExp) return String(a) === String(b);
if (a instanceof Map) {
if (!(b instanceof Map) || a.size !== b.size) return false;
for (const [key, value] of a) {
if (!b.has(key)) return false;
if (!deepEqual(value, b.get(key), seen)) return false;
}
return true;
}
if (a instanceof Set) {
if (!(b instanceof Set) || a.size !== b.size) return false;
for (const value of a) {
let found = false;
for (const other of b) if (deepEqual(value, other, seen)) { found = true; break; }
if (!found) return false;
}
return true;
}
if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
const av = new Uint8Array(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength);
const bv = new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength);
return av.every((v, i) => v === bv[i]);
}
const keysA = Object.keys(a);
const keysB = Object.keys(b);
if (keysA.length !== keysB.length) return false;
for (const key of keysA) {
if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
if (!deepEqual(a[key], b[key], seen)) return false;
}
return true;
}

export function isDeepStrictEqual(a, b) {
return deepEqual(a, b, new Map());
}

export function promisify(fn) {
return (...args) => new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));
}

export function callbackify(fn) {
return (...args) => {
const cb = args.pop();
fn(...args).then((v) => cb(null, v), (e) => cb(e));
};
}

export function deprecate(fn) {
return fn;
}

export const types = { isPromise };
export default { format, inspect, isDeepStrictEqual, promisify, callbackify, deprecate, types };
