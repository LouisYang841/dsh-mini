// node:perf_hooks shim.
const hostPerformance = globalThis.performance;

function unsupported(api) {
return () => {
throw new Error(`node:perf_hooks ${api} is not available in the spike shim`);
};
}

export const performance = {
now: () => (hostPerformance && typeof hostPerformance.now === "function" ? hostPerformance.now() : Date.now()),
mark: hostPerformance && typeof hostPerformance.mark === "function" ? hostPerformance.mark.bind(hostPerformance) : unsupported("performance.mark"),
measure: hostPerformance && typeof hostPerformance.measure === "function" ? hostPerformance.measure.bind(hostPerformance) : unsupported("performance.measure"),
clearMarks: hostPerformance && typeof hostPerformance.clearMarks === "function" ? hostPerformance.clearMarks.bind(hostPerformance) : () => {},
clearMeasures: hostPerformance && typeof hostPerformance.clearMeasures === "function" ? hostPerformance.clearMeasures.bind(hostPerformance) : () => {},
};
export const PerformanceObserver = class {
observe() {
if (!hostPerformance) throw new Error("node:perf_hooks PerformanceObserver is not available in the spike shim");
}
disconnect() {}
};
export default { performance, PerformanceObserver };
