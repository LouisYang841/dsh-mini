// node:worker_threads shim — loud failure stubs.
// Workflows/code-runtime (the real consumers) are excluded from the core
// bundle. A host that wants them must bridge to real threads.
function unavailable() {
	throw new Error("node:worker_threads is not available in the spike shim");
}
export const Worker = unavailable;
export const isMainThread = true;
export const parentPort = null;
export const workerData = undefined;
export const MessageChannel = unavailable;
export default { Worker, isMainThread, parentPort, workerData, MessageChannel };
