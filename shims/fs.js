// node:fs shim — loud failure stubs.
// The DSH core slice must never touch the filesystem; if it does, this shim
// makes the violation obvious instead of silently misbehaving.
const UNAVAILABLE = "node:fs is not available in the spike shim (core must be fs-free)";
function unavailable() {
	throw new Error(UNAVAILABLE);
}
export const readFile = unavailable;
export const readFileSync = unavailable;
export const writeFile = unavailable;
export const writeFileSync = unavailable;
export const appendFile = unavailable;
export const appendFileSync = unavailable;
export const mkdir = unavailable;
export const mkdirSync = unavailable;
export const readdir = unavailable;
export const readdirSync = unavailable;
export const stat = unavailable;
export const statSync = unavailable;
export const lstat = unavailable;
export const lstatSync = unavailable;
export const access = unavailable;
export const accessSync = unavailable;
export const rm = unavailable;
export const rmSync = unavailable;
export const rename = unavailable;
export const renameSync = unavailable;
export const createReadStream = unavailable;
export const createWriteStream = unavailable;
export const watch = unavailable;
export const realpath = unavailable;
export const realpathSync = unavailable;
export const promises = {
	readFile: unavailable,
	writeFile: unavailable,
	appendFile: unavailable,
	mkdir: unavailable,
	readdir: unavailable,
	stat: unavailable,
	lstat: unavailable,
	access: unavailable,
	rm: unavailable,
	rename: unavailable,
	realpath: unavailable,
};
export default { promises, readFileSync, writeFileSync, mkdirSync, existsSync: () => false };
