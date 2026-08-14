// Engine-level polyfills — engine-agnostic, must be imported FIRST.
// Covers: console/print, process, crypto, TextEncoder/Decoder, AbortController,
// structuredClone, Promise.withResolvers, Symbol.dispose, and ES2022/23 helpers.

import { randomUUID, getRandomValues } from "./shims/crypto.js";

// ---- stdout/stderr split: stdout carries ONLY the JSON trace ----
// On Node keep the native console; on bare engines (QuickJS) route it to
// std.err so stdout stays clean for the machine-readable trace.
const isNode = typeof process !== "undefined" && !!process.versions && !!process.versions.node;
const nodeConsoleLog = typeof console !== "undefined" && console.log ? console.log.bind(console) : null;
if (typeof print === "undefined") {
	globalThis.print = (...args) => (nodeConsoleLog ? nodeConsoleLog(...args) : void 0);
}
if (!isNode) {
	if (typeof printErr === "undefined") {
		globalThis.printErr = (s) => {
			if (typeof std !== "undefined" && std.err && std.err.write) std.err.write(String(s) + "\n");
			else if (nodeConsoleLog) nodeConsoleLog(String(s));
		};
	}
	globalThis.console = {
		log: (...a) => printErr(a.map((s) => (typeof s === "string" ? s : JSON.stringify(s))).join(" ")),
		info: (...a) => printErr(a.map((s) => (typeof s === "string" ? s : JSON.stringify(s))).join(" ")),
		warn: (...a) => printErr("WARN " + a.map((s) => (typeof s === "string" ? s : JSON.stringify(s))).join(" ")),
		error: (...a) => printErr("ERROR " + a.map((s) => (typeof s === "string" ? s : JSON.stringify(s))).join(" ")),
		debug: () => {},
		assert: (c, ...a) => {
			if (!c) printErr("ASSERT " + a.join(" "));
		},
		trace: () => {},
		dir: (...a) => printErr(a.map((s) => JSON.stringify(s)).join(" ")),
		time: () => {},
		timeEnd: () => {},
		group: () => {},
		groupEnd: () => {},
		table: () => {},
	};
}

// ---- process ----
if (typeof globalThis.process === "undefined") {
	globalThis.process = {
		env: {},
		platform: "linux",
		arch: "x64",
		version: "v22.22.1",
		versions: { node: "22.22.1" },
		nextTick: (fn) => queueMicrotask(fn),
		cwd: () => (typeof globalThis.__DSH_CWD === "string" ? globalThis.__DSH_CWD : "/"),
		hrtime: () => [0, 0],
		pid: 1,
		exit: () => {},
	};
}

// ---- crypto (global) ----
// `test-random.js` supplies a deterministic hook for the conformance driver.
// Production hosts either have a native crypto object or must provide
// `globalThis.__DSH_GET_RANDOM_VALUES`; the shim otherwise throws loud.
if (!isNode && globalThis.__DSH_CONFORMANCE === true && typeof globalThis.__DSH_GET_RANDOM_VALUES === "function") {
	globalThis.crypto = { randomUUID, getRandomValues: globalThis.__DSH_GET_RANDOM_VALUES };
} else if (typeof globalThis.crypto === "undefined") {
	globalThis.crypto = { randomUUID, getRandomValues };
} else if (typeof globalThis.crypto.randomUUID === "undefined") {
	globalThis.crypto.randomUUID = randomUUID;
}

// ---- TextEncoder / TextDecoder ----
function utf8Encode(str) {
	const out = [];
	for (let i = 0; i < str.length; i++) {
		let c = str.codePointAt(i);
		if (c > 0xffff) i++;
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
		else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
	}
	return Uint8Array.from(out);
}
function utf8Decode(u8) {
	let s = "";
	for (let i = 0; i < u8.length; i++) {
		const b = u8[i];
		if (b < 0x80) {
			s += String.fromCharCode(b);
			continue;
		}
		let cp;
		let n;
		if ((b & 0xe0) === 0xc0) {
			cp = (b & 0x1f) << 6;
			n = 1;
		} else if ((b & 0xf0) === 0xe0) {
			cp = (b & 0x0f) << 12;
			n = 2;
		} else if ((b & 0xf8) === 0xf0) {
			cp = (b & 0x07) << 18;
			n = 3;
		} else {
			s += "\uFFFD";
			continue;
		}
		let ok = i + n < u8.length;
		for (let j = 1; j <= n && ok; j++) {
			if ((u8[i + j] & 0xc0) !== 0x80) ok = false;
			else cp |= (u8[i + j] & 0x3f) << (6 * (n - j));
		}
		if (!ok) {
			s += "\uFFFD";
			continue;
		}
		i += n;
		s += String.fromCodePoint(cp);
	}
	return s;
}
if (typeof globalThis.TextEncoder === "undefined") {
	globalThis.TextEncoder = class TextEncoder {
		encode(s) {
			return utf8Encode(String(s));
		}
	};
}
if (typeof globalThis.TextDecoder === "undefined") {
	globalThis.TextDecoder = class TextDecoder {
		decode(u8 = new Uint8Array(0)) {
			return utf8Decode(u8);
		}
	};
}

// ---- structuredClone ----
if (typeof globalThis.structuredClone === "undefined") {
	globalThis.structuredClone = function structuredClone(value) {
		const seen = new WeakMap();
		function clone(x) {
			if (x === null || typeof x !== "object") return x;
			if (seen.has(x)) return seen.get(x);
			if (x instanceof Date) return new Date(x.getTime());
			if (x instanceof RegExp) return new RegExp(x.source, x.flags);
			if (x instanceof Map) {
				const m = new Map();
				seen.set(x, m);
				for (const [k, v] of x) m.set(clone(k), clone(v));
				return m;
			}
			if (x instanceof Set) {
				const s = new Set();
				seen.set(x, s);
				for (const v of x) s.add(clone(v));
				return s;
			}
			if (ArrayBuffer.isView(x)) return new x.constructor(x);
			if (x instanceof ArrayBuffer) return x.slice(0);
			if (Array.isArray(x)) {
				const a = [];
				seen.set(x, a);
				for (const v of x) a.push(clone(v));
				return a;
			}
			const o = {};
			seen.set(x, o);
			for (const k of Object.keys(x)) o[k] = clone(x[k]);
			Object.setPrototypeOf(o, Object.getPrototypeOf(x));
			return o;
		}
		return clone(value);
	};
}

// ---- Promise.withResolvers ----
if (typeof Promise.withResolvers === "undefined") {
	Promise.withResolvers = function withResolvers() {
		let resolve;
		let reject;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

// ---- AbortController / AbortSignal ----
if (typeof globalThis.AbortController === "undefined") {
	class AbortSignalPoly {
		constructor() {
			this.aborted = false;
			this.reason = undefined;
			this._listeners = [];
		}
		addEventListener(type, fn, opts) {
			if (type !== "abort" || typeof fn !== "function") return;
			if (this.aborted) {
				if (opts && opts.once) fn.call(this, this);
				return;
			}
			this._listeners.push({ fn, once: !!(opts && opts.once) });
		}
		removeEventListener(type, fn) {
			this._listeners = this._listeners.filter((l) => l.fn !== fn);
		}
		dispatchEvent() {
			return true;
		}
		throwIfAborted() {
			if (this.aborted) throw this.reason instanceof Error ? this.reason : new Error(String(this.reason ?? "Aborted"));
		}
		static any(signals) {
			const out = new AbortSignalPoly();
			const onAbort = (reason) => {
				if (!out.aborted) out._abort(reason ?? new Error("Aborted"));
			};
			for (const s of signals || []) {
				if (!s) continue;
				if (s.aborted) {
					onAbort(s.reason);
					break;
				}
				s.addEventListener("abort", () => onAbort(s.reason), { once: true });
			}
			return out;
		}
		static timeout(ms) {
			const out = new AbortSignalPoly();
			const delay = Number.isFinite(Number(ms)) ? Number(ms) : 0;
			if (typeof setTimeout === "function") {
				setTimeout(() => out._abort(new Error("TimeoutError")), Math.max(0, delay));
			} else {
				Promise.resolve().then(() => out._abort(new Error("TimeoutError")));
			}
			return out;
		}
		_abort(reason) {
			this.aborted = true;
			this.reason = reason ?? new Error("Aborted");
			const ls = this._listeners;
			this._listeners = [];
			for (const l of ls) {
				try {
					l.fn.call(this, this);
				} catch {
					// spec: listener errors are reported, never thrown here
				}
			}
		}
	}
	class AbortControllerPoly {
		constructor() {
			this.signal = new AbortSignalPoly();
		}
		abort(reason) {
			this.signal._abort(reason ?? new Error("Aborted"));
		}
	}
	globalThis.AbortController = AbortControllerPoly;
	globalThis.AbortSignal = AbortSignalPoly;
}

// ---- Symbol.dispose / Symbol.asyncDispose ----
if (typeof Symbol.dispose === "undefined") {
	Object.defineProperty(Symbol, "dispose", { value: Symbol.for("Symbol.dispose"), configurable: true });
}
if (typeof Symbol.asyncDispose === "undefined") {
	Object.defineProperty(Symbol, "asyncDispose", { value: Symbol.for("Symbol.asyncDispose"), configurable: true });
}

// ---- queueMicrotask ----
if (typeof globalThis.queueMicrotask === "undefined") {
	globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
}

// ---- ES2022/ES2023 array & object helpers ----
const defineNonEnumerable = (target, name, fn) => {
	Object.defineProperty(target, name, { value: fn, writable: true, enumerable: false, configurable: true });
};
if (typeof Object.hasOwn === "undefined") {
	Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
}
if (typeof Array.prototype.at === "undefined") {
	defineNonEnumerable(Array.prototype, "at", function at(i) {
		return i < 0 ? this[this.length + i] : this[i];
	});
}
if (typeof String.prototype.at === "undefined") {
	defineNonEnumerable(String.prototype, "at", function at(i) {
		return i < 0 ? this[this.length + i] : this[i];
	});
}
if (typeof Array.prototype.findLast === "undefined") {
	defineNonEnumerable(Array.prototype, "findLast", function findLast(fn) {
		for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i];
		return undefined;
	});
}
if (typeof Array.prototype.findLastIndex === "undefined") {
	defineNonEnumerable(Array.prototype, "findLastIndex", function findLastIndex(fn) {
		for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return i;
		return -1;
	});
}
if (typeof Array.prototype.toReversed === "undefined") {
	defineNonEnumerable(Array.prototype, "toReversed", function toReversed() {
		return this.slice().reverse();
	});
}
if (typeof Array.prototype.toSpliced === "undefined") {
	defineNonEnumerable(Array.prototype, "toSpliced", function toSpliced(start, deleteCount, ...items) {
		const copy = this.slice();
		if (arguments.length <= 1) copy.splice(start);
		else copy.splice(start, deleteCount, ...items);
		return copy;
	});
}
if (typeof String.prototype.replaceAll === "undefined") {
	defineNonEnumerable(String.prototype, "replaceAll", function replaceAll(search, replacement) {
		if (typeof search === "string") return this.split(search).join(replacement);
		return this.replace(new RegExp(search.source, search.flags.includes("g") ? search.flags : search.flags + "g"), replacement);
	});
}
if (typeof Promise.allSettled === "undefined") {
	Promise.allSettled = (ps) => Promise.all(Array.from(ps, (p) => Promise.resolve(p).then((v) => ({ status: "fulfilled", value: v }), (r) => ({ status: "rejected", reason: r }))));
}
if (typeof Object.fromEntries === "undefined") {
	Object.fromEntries = (entries) => {
		const o = {};
		for (const [k, v] of entries) o[k] = v;
		return o;
	};
}
if (typeof globalThis.AggregateError === "undefined") {
	globalThis.AggregateError = class AggregateError extends Error {
		constructor(errors, message) {
			super(message);
			this.errors = errors;
		}
	};
}

// ---- performance ----
if (typeof globalThis.performance === "undefined") {
	globalThis.performance = { now: () => Date.now(), mark() {}, measure() {} };
}

// ---- Function.prototype.toString normalization ----
// QuickJS renders native-code bodies as:
//   function Object() {\n    [native code]\n}
// while V8 renders:
//   function Object() { [native code] }
// dsh-tools' intrinsic-detection (isIntrinsicObjectPrototype) does an exact
// string compare against the V8 form, so normalize to it. Engine differences
// belong here in the compat layer, never in the DSH core.
{
	const origFnToString = Function.prototype.toString;
	Object.defineProperty(Function.prototype, "toString", {
		value: function toString() {
			const s = origFnToString.call(this);
			return s.replace(/\{\s*\[native code\]\s*\}/g, "{ [native code] }");
		},
		writable: true,
		enumerable: false,
		configurable: true,
	});
}
