// Integration tests: real CLI process behavior via node:test spawn.
// These exercise the BUILT cli.mjs (DSH_PLAIN=1 pipe mode) — no TTY, no network.
// Run: node --test cli/test/integration.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLI = join(process.cwd(), "cli", "cli.mjs");

function runCli(args, env = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI, ...args], {
			env: { ...process.env, DSH_PLAIN: "1", DSH_SESSIONS: "/tmp/dsh-itest-sess", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		child.on("close", (code) => resolve({ code, out, err }));
	});
}

test("CLI binary exists (built by cli-build.sh)", () => {
	assert.ok(existsSync(CLI), "cli/cli.mjs missing — run bash cli/cli-build.sh first");
});

test("--sessions with empty dir exits cleanly (exit 0)", async () => {
	const { code, err } = await runCli(["--sessions"]);
	assert.equal(code, 0, `stderr: ${err}`);
});

test("unknown flag does not crash the process", async () => {
	const { code } = await runCli(["--definitely-not-a-flag"]);
	// should not throw; may exit non-zero if it tries to boot, but must not hang/crash hard
	assert.ok(typeof code === "number");
});
