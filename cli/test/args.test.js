// Unit tests for cli/args.js — pure arg parsing, no I/O.
// Run: node --test cli/test/args.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, PROVIDER_DEFAULTS } from "../args.js";

test("positional first arg is the model", () => {
	const r = parseArgs(["gpt-4o-mini"], {});
	assert.equal(r.model, "gpt-4o-mini");
});

test("--provider overrides env provider", () => {
	const r = parseArgs(["--provider", "anthropic"], { DSH_PROVIDER: "google" });
	assert.equal(r.provider, "anthropic");
	assert.equal(r.providerOverride, "anthropic");
});

test("--resume captures the next token", () => {
	const r = parseArgs(["--resume", "abc123"], {});
	assert.equal(r.resumeId, "abc123");
});

test("--sessions flag is detected", () => {
	const r = parseArgs(["--sessions"], {});
	assert.equal(r.listSessions, true);
	assert.equal(r.model, "deepseek-v4-flash"); // default
});

test("default provider is deepseek-official when no keys set", () => {
	const r = parseArgs([], {});
	assert.equal(r.provider, "deepseek-official");
});

test("google becomes default when GEMINI key set and no DeepSeek key", () => {
	const r = parseArgs([], { GEMINI_API_KEY: "x" });
	assert.equal(r.provider, "google");
});

test("DeepSeek key wins over Gemini key", () => {
	const r = parseArgs([], { DEEPSEEK_API_KEY: "x", GEMINI_API_KEY: "y" });
	assert.equal(r.provider, "deepseek-official");
});

test("unknown provider falls back to default model", () => {
	const r = parseArgs([], { DSH_PROVIDER: "nope" });
	assert.equal(r.model, "deepseek-v4-flash");
});

test("PROVIDER_DEFAULTS covers all documented providers", () => {
	for (const p of ["deepseek-official", "google", "deepseek", "openai", "anthropic", "openrouter"]) {
		assert.ok(PROVIDER_DEFAULTS[p], `missing default for ${p}`);
		assert.ok(PROVIDER_DEFAULTS[p].model, `missing model for ${p}`);
		assert.ok(PROVIDER_DEFAULTS[p].keyEnv, `missing keyEnv for ${p}`);
	}
});
