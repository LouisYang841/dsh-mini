import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles, persistCredential } from "../cli/env.js";

function tmp() {
	return mkdtempSync(join(tmpdir(), "dsh-env-test-"));
}

test("loadEnvFiles: 解析 KEY=VALUE 并 trim 值", () => {
	const dir = tmp();
	const f = join(dir, "env");
	writeFileSync(f, "FOO=bar\nBAZ= qux \n#comment\n");
	const env = {};
	loadEnvFiles([f], env);
	assert.equal(env.FOO, "bar");
	assert.equal(env.BAZ, "qux");
	rmSync(dir, { recursive: true, force: true });
});

test("loadEnvFiles: 不覆盖已有环境变量", () => {
	const dir = tmp();
	const f = join(dir, "env");
	writeFileSync(f, "FOO=fromfile\n");
	const env = { FOO: "real" };
	loadEnvFiles([f], env);
	assert.equal(env.FOO, "real");
	rmSync(dir, { recursive: true, force: true });
});

test("loadEnvFiles: 不存在的文件跳过", () => {
	const env = {};
	loadEnvFiles(["/nonexistent/path/env"], env);
	assert.deepEqual(env, {});
});

test("persistCredential: 写入并返回目标路径", () => {
	const dir = tmp();
	const target = join(dir, "env");
	const r = persistCredential([target], {}, "DEEPSEEK_API_KEY", "sk-test");
	assert.equal(r, target);
	assert.equal(readFileSync(target, "utf8"), "DEEPSEEK_API_KEY=sk-test\n");
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential: 幂等（重复写替换不重复）", () => {
	const dir = tmp();
	const target = join(dir, "env");
	persistCredential([target], {}, "KEY", "v1");
	persistCredential([target], {}, "KEY", "v2");
	const content = readFileSync(target, "utf8");
	assert.equal(content.match(/^KEY=/gm).length, 1);
	assert.ok(content.includes("KEY=v2"));
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential: 保留文件里其他变量", () => {
	const dir = tmp();
	const target = join(dir, "env");
	writeFileSync(target, "OTHER=keep\n");
	persistCredential([target], {}, "KEY", "v");
	const content = readFileSync(target, "utf8");
	assert.ok(content.includes("OTHER=keep"));
	assert.ok(content.includes("KEY=v"));
	rmSync(dir, { recursive: true, force: true });
});

test("persistCredential: 全部目标失败返回 null", () => {
	// 注意：不可用 /proc 路径——Node recursive mkdir 在 procfs 上会挂起（非快速失败）。
	// 用「dirname 是文件」触发 ENOTDIR 快速失败。
	const dir = tmp();
	const notADir = join(dir, "not-a-dir");
	writeFileSync(notADir, "");
	const r = persistCredential([join(notADir, "env")], {}, "KEY", "v");
	assert.equal(r, null);
	rmSync(dir, { recursive: true, force: true });
});
