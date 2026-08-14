// node:module shim — createRequire stub.
// The DSH core only uses createRequire to read its own package.json version.
// A real host that wants true require must bridge to its module loader.
export function createRequire(base) {
	return (spec) => {
		const s = String(spec);
		if (s.includes("package.json")) {
			return { version: "0.1.0-rc.6", name: s };
		}
		throw new Error("createRequire stub cannot load module: " + s);
	};
}
export default { createRequire };
