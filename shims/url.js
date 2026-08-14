// node:url shim — POSIX file URL conversion.
export function fileURLToPath(url) {
const value = String(url);
if (!value.startsWith("file://")) throw new TypeError("The URL must be of scheme file");
let rest = value.slice("file://".length);
const slash = rest.indexOf("/");
if (slash === -1) throw new TypeError("The URL must point to a file");
const host = rest.slice(0, slash);
if (host !== "" && host !== "localhost") throw new TypeError("The file URL host must be empty or localhost");
return decodeURIComponent(rest.slice(slash));
}

export function pathToFileURL(path) {
const value = String(path);
if (value[0] !== "/") throw new TypeError("The path must be absolute");
const encoded = value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
return "file://" + encoded;
}

export const URL = globalThis.URL ?? class {
	constructor() {
		throw new Error("node:url URL is not available in the spike shim");
	}
};
export default { fileURLToPath, pathToFileURL, URL };
