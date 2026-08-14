// node:zlib shim — loud failure stubs.
// Session JSONL persistence (the real zlib consumer) is NOT part of the core
// bundle; if compression is ever needed, bridge to the host or use pako.
function unavailable() {
	throw new Error("node:zlib is not available in the spike shim");
}
export const gzip = unavailable;
export const gzipSync = unavailable;
export const gunzip = unavailable;
export const gunzipSync = unavailable;
export const deflate = unavailable;
export const deflateSync = unavailable;
export const inflate = unavailable;
export const inflateSync = unavailable;
export default { gzip, gunzip, deflate, inflate };
