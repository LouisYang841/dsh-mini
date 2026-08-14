// node:url shim.
export function fileURLToPath(url) {
	const s = String(url);
	const idx = s.indexOf("://");
	const path = idx === -1 ? s : s.slice(idx + 3);
	return decodeURIComponent(path);
}
export function pathToFileURL(path) {
	return "file://" + String(path);
}
export const URL = globalThis.URL ?? class {};
export default { fileURLToPath, pathToFileURL, URL };
