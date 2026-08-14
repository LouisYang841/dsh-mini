import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../cli/args.js";

const DEFAULTS = {
	"deepseek-official": { model: "deepseek-v4-flash", keyEnv: "DEEPSEEK_API_KEY" },
	google: { model: "gemini-flash-latest", keyEnv: "GEMINI_API_KEY" },
};

test("默认 provider 是 deepseek-official（无任何 key）", () => {
	const r = parseArgs([], {}, DEFAULTS);
	assert.equal(r.provider, "deepseek-official");
	assert.equal(r.model, "deepseek-v4-flash");
});

test("有 GEMINI key 无 DeepSeek key 时默认 google", () => {
	const r = parseArgs([], { GEMINI_API_KEY: "x" }, DEFAULTS);
	assert.equal(r.provider, "google");
});

test("--resume 缺席时 resumeId 为 undefined（不是 argv[0]，防 SKILL.md L135 坑）", () => {
	const r = parseArgs(["some-model"], {}, DEFAULTS);
	assert.equal(r.resumeId, undefined);
});

test("--resume 带 id 时正确解析", () => {
	const r = parseArgs(["--resume", "abc123"], {}, DEFAULTS);
	assert.equal(r.resumeId, "abc123");
});

test("--provider 覆盖默认", () => {
	const r = parseArgs(["--provider", "google"], {}, DEFAULTS);
	assert.equal(r.provider, "google");
});

test("--sessions 标志解析", () => {
	assert.equal(parseArgs(["--sessions"], {}, DEFAULTS).listSessions, true);
	assert.equal(parseArgs([], {}, DEFAULTS).listSessions, false);
});

test("位置参数第一个是 model", () => {
	const r = parseArgs(["my-model"], { DEEPSEEK_API_KEY: "x" }, DEFAULTS);
	assert.equal(r.model, "my-model");
});

test("DSH_PROVIDER 环境变量优先", () => {
	const r = parseArgs([], { DSH_PROVIDER: "google" }, DEFAULTS);
	assert.equal(r.provider, "google");
});
