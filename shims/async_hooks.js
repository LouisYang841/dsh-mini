// node:async_hooks shim — AsyncLocalStorage over a patched Promise chain.
//
// Strategy: `currentStore` is a single global (single-threaded engines only).
// Every promise REACTION captures `currentStore` at registration time and
// restores it while the reaction runs. This mirrors AsyncLocalStorage for
// promise-based control flow as long as:
//  1. all async/await in the bundle is lowered (esbuild target <= es2016),
//     because lowered await goes through JS-visible Promise.prototype.then;
//  2. this module is imported BEFORE any promise chaining happens.

let currentStore = undefined;

function wrap(fn, captured) {
	if (typeof fn !== "function") return fn;
	return function wrapped(...args) {
		const prev = currentStore;
		currentStore = captured;
		try {
			return fn.apply(this, args);
		} finally {
			currentStore = prev;
		}
	};
}

const origThen = Promise.prototype.then;
Promise.prototype.then = function then(onFulfilled, onRejected) {
	const captured = currentStore;
	return origThen.call(this, wrap(onFulfilled, captured), wrap(onRejected, captured));
};

const origCatch = Promise.prototype.catch;
Promise.prototype.catch = function catch_(onRejected) {
	const captured = currentStore;
	return origCatch.call(this, wrap(onRejected, captured));
};

if (Promise.prototype.finally) {
	const origFinally = Promise.prototype.finally;
	Promise.prototype.finally = function finally_(onFinally) {
		const captured = currentStore;
		return origFinally.call(this, wrap(onFinally, captured));
	};
}

export class AsyncLocalStorage {
	getStore() {
		return currentStore;
	}
	run(store, fn, ...args) {
		const prev = currentStore;
		currentStore = store;
		try {
			return fn(...args);
		} finally {
			currentStore = prev;
		}
	}
	enterWith(store) {
		// Node semantics: the store stays active until disable() or run()
		// restores a different value; enterWith returns undefined.
		currentStore = store;
	}
	disable() {
		currentStore = undefined;
	}
}

export const executionAsyncId = () => 0;
export const triggerAsyncId = () => 0;
export default { AsyncLocalStorage, executionAsyncId, triggerAsyncId };
