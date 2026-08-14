// Minimal node:buffer shim (Uint8Array-backed).
export class Buffer extends Uint8Array {
	static from(input, encoding) {
		if (typeof input === "string") {
			if (encoding === "hex" || encoding === "base64" || encoding === "base64url") {
				return new Buffer(decodeBinary(input, encoding));
			}
			const bytes = [];
			for (let i = 0; i < input.length; i++) {
				let c = input.codePointAt(i);
				if (c > 0xffff) i++;
				if (c < 0x80) bytes.push(c);
				else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
				else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
				else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
			}
			return new Buffer(bytes);
		}
		if (ArrayBuffer.isView(input)) return new Buffer(input);
		if (input instanceof ArrayBuffer) return new Buffer(new Uint8Array(input));
		return new Buffer(Array.from(input));
	}
	static alloc(size) {
		return new Buffer(new Uint8Array(size));
	}
	static concat(list) {
		let total = 0;
		for (const b of list) total += b.length;
		const out = new Uint8Array(total);
		let off = 0;
		for (const b of list) {
			out.set(b, off);
			off += b.length;
		}
		return new Buffer(out);
	}
	static isBuffer(v) {
		return v instanceof Buffer;
	}
	static byteLength(str) {
		return Buffer.from(String(str)).length;
	}
	toString(encoding) {
		if (encoding === "hex" || encoding === "base64" || encoding === "base64url") {
			return encodeBinary(this, encoding);
		}
		let s = "";
		for (let i = 0; i < this.length; i++) {
			const b = this[i];
			if (b < 0x80) {
				s += String.fromCharCode(b);
				continue;
			}
			let cp;
			let n;
			if ((b & 0xe0) === 0xc0) {
				cp = (b & 0x1f) << 6;
				n = 1;
			} else if ((b & 0xf0) === 0xe0) {
				cp = (b & 0x0f) << 12;
				n = 2;
			} else if ((b & 0xf8) === 0xf0) {
				cp = (b & 0x07) << 18;
				n = 3;
			} else {
				s += "\uFFFD";
				continue;
			}
			let ok = true;
			for (let j = 1; j <= n; j++) {
				if (i + j >= this.length || (this[i + j] & 0xc0) !== 0x80) {
					ok = false;
					break;
				}
				cp |= (this[i + j] & 0x3f) << (6 * (n - j));
			}
			if (!ok) {
				s += "\uFFFD";
				continue;
			}
			i += n;
			s += String.fromCodePoint(cp);
		}
		return s;
	}
	subarray(start, end) {
		return new Buffer(Uint8Array.prototype.subarray.call(this, start, end));
	}
	slice(start, end) {
		return this.subarray(start, end);
	}
	equals(other) {
		if (other.length !== this.length) return false;
		for (let i = 0; i < this.length; i++) if (other[i] !== this[i]) return false;
		return true;
	}
}

function decodeBinary(input, encoding) {
	if (encoding === "base64" || encoding === "base64url") {
		let s = String(input).replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
		while (s.length % 4) s += "=";
		const out = [];
		for (let i = 0; i < s.length; i += 4) {
			const a = B64.indexOf(s[i]);
			const b = B64.indexOf(s[i + 1]);
			const c = s[i + 2] === "=" ? 0 : B64.indexOf(s[i + 2]);
			const d = s[i + 3] === "=" ? 0 : B64.indexOf(s[i + 3]);
			out.push((a << 2) | (b >> 4));
			if (s[i + 2] !== "=") out.push(((b & 15) << 4) | (c >> 2));
			if (s[i + 3] !== "=") out.push(((c & 3) << 6) | d);
		}
		return out;
	}
	if (encoding === "hex") {
		const out = [];
		const s = String(input).replace(/\s/g, "");
		for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
		return out;
	}
	throw new Error("unsupported encoding: " + encoding);
}

function encodeBinary(bytes, encoding) {
	if (encoding === "base64" || encoding === "base64url") {
		let s = "";
		for (let i = 0; i < bytes.length; i += 3) {
			const a = bytes[i];
			const b = bytes[i + 1];
			const c = bytes[i + 2];
			s += B64[a >> 2] + B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)] + (b === undefined ? "=" : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)]) + (c === undefined ? "=" : B64[c & 63]);
		}
		return encoding === "base64url" ? s.replace(/\+/g, "-").replace(/\//g, "_") : s;
	}
	if (encoding === "hex") {
		let s = "";
		for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16);
		return s;
	}
	throw new Error("unsupported encoding: " + encoding);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const constants = { MAX_LENGTH: 1e9 };
export default { Buffer, constants };
