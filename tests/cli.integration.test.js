// CLI 集成测试：spawn 构建后的 cli.mjs（DSH_PLAIN=1 管道模式）。
// 用 DSH_FAKE_LLM=1 的脚本化 adapter（无网络、无 key）跑完整会话，
// 覆盖 SKILL.md 记录的三个 CLI 层坑：管道吞行、退出 flush、裸命令 fall-through。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "cli.mjs");

function runCli(args, input, env = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI, ...args], {
			env: { ...process.env, DSH_PLAIN: "1", DSH_NO_BANNER: "1", ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, out, err });
		});
		if (input) child.stdin.write(input);
		child.stdin.end();
	});
}

const FAKE = (sessionsDir) => ({
	DSH_FAKE_LLM: "1",
	DSH_PROVIDER: "fake",
	DSH_SESSIONS: sessionsDir,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("--sessions 无会话时正常退出 0（CLI boot 冒烟）", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-sess-test-"));
	const r = await runCli(["--sessions"], "", { DSH_SESSIONS: dir });
	rmSync(dir, { recursive: true, force: true });
	assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 500)}`);
});

test("管道连续输入全部被消费，不吞行（SKILL.md 管道吞行坑）", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-pipe-test-"));
	// 两行输入各触发一次 turn；fake LLM 每次回 "(default reply)"。
	// 吞行 bug 会导致回复次数 < 2。
	const r = await runCli([], "hello\nworld\n/exit\n", FAKE(dir));
	const replies = (r.out.match(/\(default reply\)/g) || []).length;
	rmSync(dir, { recursive: true, force: true });
	assert.ok(
		replies >= 2,
		`期望至少 2 次回复（两行都被消费），实际 ${replies}。输出: ${r.out.slice(0, 400)}`,
	);
});

test("/stats 后退出前 flush 写盘，200ms 批窗不丢（SKILL.md L304 坑）", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-flush-test-"));
	// 先有一次对话（产生会话事件），再 /stats + /exit——纯命令会话无事件可写，
	// 无法验证 flush。退出时 gracefulExit 必须 await flush 完成再 exit。
	const r = await runCli([], "hello\n/stats\n/exit\n", FAKE(dir));
	// 等待写批窗口（200ms）落盘
	await sleep(1000);
	const files = readdirSync(dir, { recursive: true }).map(String);
	rmSync(dir, { recursive: true, force: true });
	assert.ok(
		files.some((f) => f.includes("session")),
		`会话文件应已写入。实际文件: ${files.slice(0, 6).join(", ") || "(空)"}`,
	);
});

test("裸 /provider 被命令处理器拦截，不 fall-through 给模型（SKILL.md L270 坑）", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-cmd-test-"));
	const r = await runCli([], "/provider\n/exit\n", FAKE(dir));
	rmSync(dir, { recursive: true, force: true });
	// 若 fall-through，/provider 会作为 prompt 发给模型 → 输出含 fake 回复。
	// 断言模型未被调用 = 命令被拦截。
	assert.ok(
		!r.out.includes("(default reply)"),
		`裸 /provider 不应触发模型调用。输出: ${r.out.slice(0, 400)}`,
	);
});
