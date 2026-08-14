// node:crypto shim — randomUUID + getRandomValues.
// NOTE: pseudo-random (Math.random-based). Fine for ids in a spike; a real
// host must bridge to its own CSPRNG (Android: java.security.SecureRandom).

export function randomUUID() {
	const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
	return (
		h() + h() + "-" + h() + "-4" + h().slice(1) + "-" +
		(8 + Math.floor(Math.random() * 4)).toString(16) + h().slice(1) + "-" + h() + h() + h()
	);
}

export function getRandomValues(array) {
	for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
	return array;
}

export function createHash() {
	throw new Error("crypto.createHash is not available in the spike shim");
}

export default { randomUUID, getRandomValues, createHash };
