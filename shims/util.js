// Minimal node:util shim.
import { isPromise } from "./util_types.js";

export function format(...args) {
	return args.map((a) => (typeof a === "string" ? a : inspect(a))).join(" ");
}

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

export function isDeepStrictEqual(a, b) {
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return a === b;
	}
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
