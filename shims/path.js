// POSIX-only path shim (node:path replacement for non-Node engines).
const sep = "/";

function normalizeArray(parts, allowAboveRoot) {
	let up = 0;
	const res = [];
	for (let i = parts.length - 1; i >= 0; i--) {
		const last = parts[i];
		if (last === ".") continue;
		if (last === "..") {
			up++;
			continue;
		}
		if (up > 0) {
			up--;
			continue;
		}
		res.unshift(last);
	}
	if (allowAboveRoot) for (; up > 0; up--) res.unshift("..");
	return res;
}

export function normalize(path) {
	const isAbs = isAbsolute(path);
	const trailingSlash = path && path[path.length - 1] === "/";
	path = normalizeArray(String(path).split("/").filter(Boolean), !isAbs).join("/");
	if (!path && !isAbs) path = ".";
	if (path && trailingSlash) path += "/";
	return (isAbs ? "/" : "") + path;
}

export function join(...args) {
	let path = "";
	for (const arg of args) {
		if (arg) path += (path ? "/" : "") + String(arg);
	}
	return normalize(path);
}

export function resolve(...args) {
	let resolvedPath = "";
	let resolvedAbsolute = false;
	for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
		const arg = args[i];
		if (typeof arg !== "string" || arg === "") continue;
		resolvedPath = arg + (resolvedPath ? "/" : "") + resolvedPath;
		resolvedAbsolute = arg[0] === "/";
	}
	resolvedPath = normalizeArray(resolvedPath.split("/").filter(Boolean), !resolvedAbsolute).join("/");
	return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
}

export function isAbsolute(path) {
	return typeof path === "string" && path.length > 0 && path[0] === "/";
}

export function relative(from, to) {
	from = resolve(from).slice(1);
	to = resolve(to).slice(1);
	const fromParts = from.split("/").filter(Boolean);
	const toParts = to.split("/").filter(Boolean);
	let common = 0;
	while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
	const up = fromParts.length - common;
	const out = [];
	for (let i = 0; i < up; i++) out.push("..");
	for (let i = common; i < toParts.length; i++) out.push(toParts[i]);
	return out.join("/") || (to === from ? "" : ".");
}

export function dirname(path) {
	const p = String(path).replace(/\/+$/, "");
	const idx = p.lastIndexOf("/");
	if (idx === -1) return ".";
	if (idx === 0) return "/";
	return p.slice(0, idx);
}

export function basename(path, ext) {
	let p = String(path);
	if (ext !== undefined && p.endsWith(ext)) p = p.slice(0, -ext.length);
	const idx = p.lastIndexOf("/");
	return idx === -1 ? p : p.slice(idx + 1);
}

export function extname(path) {
	const base = basename(path);
	const idx = base.lastIndexOf(".");
	return idx <= 0 ? "" : base.slice(idx);
}

export const posix = { sep, normalize, join, resolve, isAbsolute, relative, dirname, basename, extname };
export default posix;
