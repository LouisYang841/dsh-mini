// Build the Operit tool package: operit/src/main.js -> operit/dist/main.js
// (commonjs, es2020 — Operit's toolchain target — with every node:* import
// aliased to the portable shims, exactly like cli/cli-build.sh).
import { build } from "/home/ubuntu/Dsh_workspace/spike-tools/node_modules/esbuild/lib/main.js";
import { readFileSync } from "node:fs";

const root = new URL(".", import.meta.url).pathname; // spike/operit/
const shimsDir = root + "../shims/"; // spike/shims/

const nodeAliases = {};
for (const name of [
	"path",
	"util",
	"crypto",
	"async_hooks",
	"module",
	"events",
	"perf_hooks",
	"timers",
	"os",
	"fs",
	"buffer",
	"url",
	"stream",
	"zlib",
	"worker_threads",
	"child_process",
	"sqlite",
]) {
	nodeAliases[`node:${name}`] = `${shimsDir}${name}.js`;
}
nodeAliases["node:fs/promises"] = `${shimsDir}fs-promises.js`;
nodeAliases["node:util/types"] = `${shimsDir}util_types.js`;

await build({
	entryPoints: [root + "src/main.js"],
	outfile: root + "dist/main.js",
	bundle: true,
	format: "cjs",
	platform: "neutral",
	// The ALS prelude in shims/async_hooks.js patches Promise.prototype.then
	// and REQUIRES es2016 lowering (async -> generators), exactly like
	// cli/cli-build.sh. Native async (es2020) silently loses the ALS context
	// and the tool scheduler drops model tool calls.
	target: "es2016",
	alias: nodeAliases,
	mainFields: ["module", "main"],
	logLevel: "warning",
});

const size = readFileSync(root + "dist/main.js").length;
console.log(`built: operit/dist/main.js (${size} bytes)`);

// ESM variant for the QuickJS verification harness (qjs -m cannot load CJS).
await build({
	entryPoints: [root + "src/main.js"],
	outfile: root + "dist/main.esm.mjs",
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2016",
	alias: nodeAliases,
	mainFields: ["module", "main"],
	logLevel: "warning",
});

const esmSize = readFileSync(root + "dist/main.esm.mjs").length;
console.log(`built: operit/dist/main.esm.mjs (${esmSize} bytes)`);
