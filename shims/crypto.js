// node:crypto shim — randomUUID + getRandomValues.
// The core bundle must never fall back to Math.random for security-sensitive
// randomness. Bridge to the host CSPRNG when available; otherwise fail loud
// so a host author wires in its platform RNG (Android:
// java.security.SecureRandom) through globalThis.__DSH_GET_RANDOM_VALUES.

const hostCrypto = globalThis.crypto;
const nativeGetRandomValues = hostCrypto && typeof hostCrypto.getRandomValues === "function"
? hostCrypto.getRandomValues.bind(hostCrypto)
: undefined;
const nativeRandomUUID = hostCrypto && typeof hostCrypto.randomUUID === "function"
? hostCrypto.randomUUID.bind(hostCrypto)
: undefined;

export function getRandomValues(array) {
if (nativeGetRandomValues) return nativeGetRandomValues(array);
if (typeof globalThis.__DSH_GET_RANDOM_VALUES === "function") return globalThis.__DSH_GET_RANDOM_VALUES(array);
throw new Error("node:crypto shim requires a host crypto.getRandomValues implementation");
}

export function randomUUID() {
if (nativeRandomUUID) return nativeRandomUUID();
const bytes = new Uint8Array(16);
getRandomValues(bytes);
bytes[6] = (bytes[6] & 0x0f) | 0x40;
bytes[8] = (bytes[8] & 0x3f) | 0x80;
const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createHash() {
throw new Error("crypto.createHash is not available in the spike shim");
}

export default { randomUUID, getRandomValues, createHash };
