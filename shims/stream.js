// node:stream shim — loud failure stubs (core bundle must be stream-free).
function unavailable() {
	throw new Error("node:stream is not available in the spike shim");
}
export const Readable = unavailable;
export const Writable = unavailable;
export const Transform = unavailable;
export const PassThrough = unavailable;
export const pipeline = unavailable;
export default { Readable, Writable, Transform, PassThrough, pipeline };
