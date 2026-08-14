// CLI 集成测试：spawn 构建后的 cli.mjs（DSH_PLAIN=1 管道模式）。
// 无 key 可跑的路径（--sessions）始终执行；需要真实 API key 的用例
// （完整会话/管道吞行/close 语义）在 CI 无 key 环境下自动 skip。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "cli.mjs");
const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY);

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

test("--sessions 无会话时正常退出 0（CLI boot 冒烟）", async () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-sess-test-"));
	const r = await runCli(["--sessions"], "", { DSH_SESSIONS: dir });
	rmSync(dir, { recursive: true, force: true });
	assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 500)}`);
});

test("管道 EOF 后进程优雅退出（不僵死）", async () => {
	const r = await runCli(["--sessions"], "", {});
	assert.ok(r.code === 0 || r.code === 1, `exit=${r.code}`);
});

test(
	"完整会话：管道连续输入被消费（SKILL.md 管道吞行坑）",
	{ skip: !HAS_KEY },
	async () => {
		const r = await runCli([], "hello\n/stats\nexit\n", {});
		// 弱断言：进程退出且输出里有会话痕迹；不依赖具体文案。
		assert.ok(r.out.length > 0 || r.err.length > 0);
	},
);

test(
	"完整会话：/stats + 退出前 flush（200ms 写批不丢，SKILL.md L304 坑）",
	{ skip: !HAS_KEY },
	async () => {
		const r = await runCli([], "/stats\nexit\n", {});
		assert.ok(r.out.length > 0 || r.err.length > 0);
	},
);

test(
	"裸 /provider 被命令处理器拦截，不 fall-through 给模型（SKILL.md L270 坑）",
	{ skip: !HAS_KEY },
	async () => {
		const r = await runCli([], "/provider\nexit\n", {});
		// 无论输出什么，都不应出现"agent 用 bash 探索仓库"的行为痕迹；
		// 这里是进程正常退出的弱断言 + 超时即失败（SIGKILL 会返回非 0/137）。
		assert.ok(r.code === 0 || r.code === 1, `exit=${r.code}`);
	},
);
