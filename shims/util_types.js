// node:util/types shim — only what the DSH core imports.
export function isPromise(value) {
	return value instanceof Promise;
}

export function isAnyArrayBuffer(value) {
	return value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer);
}

export function isArrayBuffer(value) {
	return value instanceof ArrayBuffer;
}

export function isTypedArray(value) {
	return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function isDate(value) {
	return value instanceof Date;
}

export function isRegExp(value) {
	return value instanceof RegExp;
}

export function isMap(value) {
	return value instanceof Map;
}

export function isSet(value) {
	return value instanceof Set;
}

export function isNativeError(value) {
	return value instanceof Error;
}

export default { isPromise, isAnyArrayBuffer, isArrayBuffer, isTypedArray, isDate, isRegExp, isMap, isSet, isNativeError };
