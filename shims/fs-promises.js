// node:fs/promises shim — Android app-sandbox compatibility.
// Android's SELinux policy denies hard links inside app-private storage
// (link() returns EACCES). dsh-session-persistence-jsonl publishes each
// session file as: temp-write + fsync + link(tmp, final) + dir-fsync, and
// swallows the resulting error — sessions silently never materialize
// (empty per-session dirs). Fall back to rename(), which Android allows and
// which is an equivalent atomic same-directory publish for a NEW file.
// Reference: pi's JSONL repo does exactly this on every platform
// (publishFileAtomically: "Build a complete sibling temporary file, then
// atomically rename it over the destination") — which is why pi persists
// fine on Termux and the DSH backend did not.
// Every other export passes through untouched.
const native = process.getBuiltinModule("node:fs/promises");

// Serialize link publication. On Android, link() is denied and a naive
// rename fallback can overwrite a destination published by a concurrent
// writer. copyFile with COPYFILE_EXCL preserves no-clobber semantics.
let publishQueue = Promise.resolve();

async function publishLink(existing, next) {
	try {
		return await native.link(existing, next);
	} catch (error) {
		if (error?.code === "EACCES" || error?.code === "EPERM" || error?.code === "EXDEV" || error?.code === "EOPNOTSUPP" || error?.code === "ENOTSUP") {
			// link() is denied on Android. The serialized queue makes this
			// destination check race-free among dsh-mini publishers, and
			// rename is atomic on the same filesystem, so readers never see a
			// partially copied JSONL file.
			const exists = await native.stat(next).then(() => true, () => false);
			if (exists) {
				const conflict = new Error(`EEXIST: ${next} already exists`);
				conflict.code = "EEXIST";
				throw conflict;
			}
			return await native.rename(existing, next);
		}
		throw error;
	}
}

export function link(existing, next) {
	const operation = publishQueue.then(() => publishLink(existing, next));
	publishQueue = operation.catch(() => {});
	return operation;
}

export const access = native.access;
export const appendFile = native.appendFile;
export const chmod = native.chmod;
export const chown = native.chown;
export const constants = native.constants;
export const copyFile = native.copyFile;
export const cp = native.cp;
export const lchmod = native.lchmod;
export const lchown = native.lchown;
export const lutimes = native.lutimes;
export const lstat = native.lstat;
export const mkdir = native.mkdir;
export const mkdtemp = native.mkdtemp;
export const open = native.open;
export const opendir = native.opendir;
export const readdir = native.readdir;
export const readFile = native.readFile;
export const readlink = native.readlink;
export const realpath = native.realpath;
export const rename = native.rename;
export const rm = native.rm;
export const rmdir = native.rmdir;
export const stat = native.stat;
export const statfs = native.statfs;
export const symlink = native.symlink;
export const truncate = native.truncate;
export const unlink = native.unlink;
export const utimes = native.utimes;
export const watch = native.watch;
export const writeFile = native.writeFile;

export default native;
