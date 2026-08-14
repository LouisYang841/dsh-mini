// REFERENCE implementation of the dsh "fs" service contract (seam ②).
// The Node CLI mounts the official @deepseek-ai/dsh-fs-local backend instead
// (koffi is a Windows-only lazy import there, so it is pure on Linux/Termux);
// this file stays as the contract reference for NON-Node hosts (Android SAF,
// remote SFTP, ...). Do not mount it in the CLI.
import { FileSystem, FsError } from "@deepseek-ai/dsh-fs";
import z from "@deepseek-ai/schemastery";
import { join, dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { promises as fsp, existsSync } from "node:fs";

export class NodeFs extends FileSystem {
	static Config = z.object({
		cwd: z.string().description("Workspace root for relative path resolution."),
	});
	constructor(ctx, config = {}) {
		super(ctx);
		this.config = { cwd: config.cwd ?? process.cwd() };
	}
	get sandboxMode() {
		return undefined; // no confinement in the Node CLI build
	}
	checkAborted(signal) {
		if (signal?.aborted) throw new FsError("aborted", "FS_ABORTED");
	}
	async resolve(path, opts) {
		this.checkAborted(opts?.signal);
		const base = opts?.cwd ?? this.config.cwd;
		const resolved = isAbsolute(path) ? pathResolve(path) : pathResolve(base, path);
		return { targetKey: resolved, displayPath: resolved };
	}
	processPath(target) {
		return String(target.targetKey);
	}
	async stat(target, signal) {
		this.checkAborted(signal);
		try {
			const info = await fsp.stat(target.targetKey);
			return {
				version: String(info.mtimeMs),
				type: info.isDirectory() ? "directory" : "file",
				size: info.size,
			};
		} catch {
			return undefined;
		}
	}
	async lstat(path, opts, signal) {
		this.checkAborted(signal);
		const target = await this.resolve(path, opts);
		return this.stat(target, signal);
	}
	async readText(target, signal) {
		this.checkAborted(signal);
		try {
			return await fsp.readFile(target.targetKey, "utf8");
		} catch {
			throw new FsError(`cannot read "${target.displayPath}": file does not exist`, "FS_NOT_FOUND");
		}
	}
	async streamText(target, signal) {
		const text = await this.readText(target, signal);
		return text.split(/\r?\n/);
	}
	async readBytes(target, signal, maxBytes) {
		this.checkAborted(signal);
		let buffer;
		try {
			buffer = await fsp.readFile(target.targetKey);
		} catch {
			throw new FsError(`cannot read "${target.displayPath}": file does not exist`, "FS_NOT_FOUND");
		}
		if (maxBytes !== undefined && buffer.length > maxBytes) {
			throw new FsError(`cannot read "${target.displayPath}": file is ${buffer.length} bytes, over the ${maxBytes} byte cap`, "FS_TOO_LARGE");
		}
		return buffer;
	}
	async listDir(target, signal) {
		this.checkAborted(signal);
		let entries;
		try {
			entries = await fsp.readdir(target.targetKey, { withFileTypes: true });
		} catch {
			throw new FsError(`cannot list "${target.displayPath}": directory does not exist`, "FS_NOT_FOUND");
		}
		return entries.map((entry) => ({
			name: entry.name,
			type: entry.isDirectory() ? "directory" : "file",
			target: {
				targetKey: join(target.targetKey, entry.name),
				displayPath: join(target.displayPath, entry.name),
			},
		}));
	}
	async writeText(target, content, expected, signal) {
		this.checkAborted(signal);
		const existing = await this.stat(target, signal);
		if (expected?.kind === "createIfAbsent" && existing) {
			throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
		}
		if (expected?.kind === "replaceIfVersion") {
			if (!existing) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
			if (existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
		}
		const before = existing ? await this.readText(target, signal).catch(() => null) : null;
		await fsp.mkdir(dirname(target.targetKey), { recursive: true });
		await fsp.writeFile(target.targetKey, content, "utf8");
		return {
			operation: existing ? "update" : "create",
			before,
			after: content,
		};
	}
	async editText(target, edit, expected, signal) {
		this.checkAborted(signal);
		const existing = await this.stat(target, signal);
		if (!existing) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
		if (expected && existing.version !== expected.version) {
			throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
		}
		const original = await this.readText(target, signal);
		const occurrences = edit.replaceAll ? undefined : 1;
		let count = 0;
		let edited = original;
		if (edit.replaceAll) {
			edited = original.split(edit.oldString).join(edit.newString);
			count = original.split(edit.oldString).length - 1;
		} else {
			if (original.includes(edit.oldString)) {
				edited = original.replace(edit.oldString, edit.newString);
				count = 1;
			}
		}
		if (count === 0) {
			throw new FsError(`cannot edit "${target.displayPath}": old string not found`, "FS_EDIT_TARGET_NOT_FOUND");
		}
		await fsp.writeFile(target.targetKey, edited, "utf8");
		const after = await this.stat(target, signal);
		return { version: after?.version ?? "0", before: original, after: edited };
	}
}
export default NodeFs;
