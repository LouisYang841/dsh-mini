// Minimal node:events shim.
export class EventEmitter {
	constructor() {
		this._listeners = new Map();
	}
	on(type, fn) {
		let arr = this._listeners.get(type);
		if (!arr) this._listeners.set(type, (arr = []));
		arr.push(fn);
		return this;
	}
	once(type, fn) {
		const wrapped = (...args) => {
			this.off(type, wrapped);
			return fn(...args);
		};
		return this.on(type, wrapped);
	}
	off(type, fn) {
		const arr = this._listeners.get(type);
		if (!arr) return this;
		const idx = arr.indexOf(fn);
		if (idx >= 0) arr.splice(idx, 1);
		return this;
	}
	removeAllListeners(type) {
		if (type === undefined) this._listeners.clear();
		else this._listeners.delete(type);
		return this;
	}
	emit(type, ...args) {
		const arr = this._listeners.get(type);
		if (!arr) return false;
		for (const fn of [...arr]) {
			try {
				fn(...args);
			} catch {
				// EventEmitter spec: emit ignores listener errors
			}
		}
		return true;
	}
	listenerCount(type) {
		return this._listeners.get(type)?.length ?? 0;
	}
}
export default EventEmitter;
