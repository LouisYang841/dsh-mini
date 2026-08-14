// node:child_process shim — loud failure stubs.
// The bash/terminal tool family is host-specific (impossible on stock
// Android); the core bundle must not spawn processes.
function unavailable() {
	throw new Error("node:child_process is not available in the spike shim");
}
export const spawn = unavailable;
export const spawnSync = unavailable;
export const exec = unavailable;
export const execSync = unavailable;
export const execFile = unavailable;
export const fork = unavailable;
export default { spawn, spawnSync, exec, execSync, execFile, fork };
