// node:perf_hooks shim.
export const performance = {
	now: () => Date.now(),
	mark() {},
	measure() {},
	clearMarks() {},
	clearMeasures() {},
};
export const PerformanceObserver = class {
	observe() {}
	disconnect() {}
};
export default { performance, PerformanceObserver };
