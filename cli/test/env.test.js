// Unit tests for cli/env.js — env file loading + credential persistence.
// Uses temp dirs (no real user config touched).
// Run: node --test cli/test/env.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles, persistCredential } from "../env.js";

function tmp() {
	return mkdtempSync(join(tmpdir(), "dsh-env-test-"));
}

test("loadEnvFiles reads KEY=VALUE lines", () => {
	const dir = tmp();
	const file = join(dir, "env");
	writeFileSync(file, "FOO=bar\nBAZ=qux\n");
	const env = {};
	loadEnvFiles([file], env);
	assert.equal(env.FOO, "bar");
	assert.equal(env.BAZ, "qux");
	rmSync(dir, { recursive: true, force: true });
});

test("loadEnvFiles never overrides existing env vars", () => {
	const dir = tmp();
	const file = join(dir, "env");
	writeFileSync(file, "FOO=from-file\n");
	const env = { FOO: "already-set" };
	loadEnvFiles([file], env);
	assert.equal(env.FOO, "already-set");
	rmSync(dir, { recursive: true, force: true });
});

test("loadEnvFiles skips missing files silently", () => {
	const env = {};
	loadEnvFiles(["/nonexistent/definitely/missing"], env);
	assert.deepEqual(env, {});
});

test("loadEnvFiles trims values and handles CRLF", () => {
	const dir = tmp();
	const file = join(dir, "env");
	writeFileSync(file, "A=  spaced  \r\nB=plain\r\n");
	const env = {};
	loadEnvFiles([file], env);
	assert.equal(env.A, "spaced");
	assert.equal(env.B, "plain");
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential writes to the first writable target", () => {
	const dir = tmp();
	const t1 = join(dir, "a", "env");
	const t2 = join(dir, "b", "env");
	const written = persistCredential([t1, t2], "TEST_KEY", "secret");
	assert.equal(written, t1);
	assert.match(readFileSync(t1, "utf8"), /^TEST_KEY=secret\n$/);
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential replaces existing key line", () => {
	const dir = tmp();
	const t = join(dir, "env");
	writeFileSync(t, "OLD=1\nTEST_KEY=stale\nKEEP=2\n");
	persistCredential([t], "TEST_KEY", "fresh");
	const content = readFileSync(t, "utf8");
	assert.match(content, /^TEST_KEY=fresh$/m);
	assert.match(content, /^KEEP=2$/m);
	assert.doesNotMatch(content, /stale/);
	assert.doesNotMatch(content, /^TEST_KEY=stale$/m); // stale line removed
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential appends when file has no trailing newline", () => {
	const dir = tmp();
	const t = join(dir, "env");
	writeFileSync(t, "EXISTING=1");
	persistCredential([t], "NEW_KEY", "v");
	const content = readFileSync(t, "utf8");
	assert.match(content, /^EXISTING=1$/m);
	assert.match(content, /^NEW_KEY=v$/m);
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential returns null when all targets unwritable", () => {
	const dir = tmp();
	// target path inside a *file* (not a dir) → mkdir fails fast, no hang
	const blocker = join(dir, "not-a-dir");
	writeFileSync(blocker, "x");
	const written = persistCredential([join(blocker, "env")], "K", "v");
	assert.equal(written, null);
	rmSync(dir, { recursive: true, force: true });
});
