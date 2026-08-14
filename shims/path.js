// POSIX-only path shim (node:path replacement for non-Node engines).
const sep = "/";

function cwd() {
if (typeof process !== "undefined" && typeof process.cwd === "function") {
try {
return process.cwd();
} catch {
// fall through to root
}
}
return "/";
}

function normalizeArray(parts, allowAboveRoot) {
let up = 0;
const res = [];
for (let i = parts.length - 1; i >= 0; i--) {
const last = parts[i];
if (last === "." || last === "") continue;
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
for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
const arg = i >= 0 ? args[i] : cwd();
if (typeof arg !== "string" || arg === "") continue;
resolvedPath = arg + (resolvedPath ? "/" : "") + resolvedPath;
resolvedAbsolute = arg[0] === "/";
}
return normalize(resolvedPath);
}

export function isAbsolute(path) {
return typeof path === "string" && path.length > 0 && path[0] === "/";
}

export function relative(from, to) {
const fromAbs = resolve(from);
const toAbs = resolve(to);
const fromParts = fromAbs.split("/").filter(Boolean);
const toParts = toAbs.split("/").filter(Boolean);
let common = 0;
while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
const up = fromParts.length - common;
const out = [];
for (let i = 0; i < up; i++) out.push("..");
for (let i = common; i < toParts.length; i++) out.push(toParts[i]);
return out.join("/") || (fromAbs === toAbs ? "" : ".");
}

export function dirname(path) {
let p = String(path);
while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
const idx = p.lastIndexOf("/");
if (idx === -1) return ".";
if (idx === 0) return "/";
return p.slice(0, idx);
}

export function basename(path, ext) {
let p = String(path);
while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
if (ext !== undefined && p.endsWith(ext) && p !== ext) p = p.slice(0, -ext.length);
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
