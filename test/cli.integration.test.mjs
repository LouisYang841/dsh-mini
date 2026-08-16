// CLI integration tests using the scripted fake provider
// (DSH_FAKE_LLM=1 + DSH_PROVIDER=fake): no network, no API key.
// The built cli/cli.mjs must exist (CI builds it before `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "cli.mjs");

function runCli(input, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mini-cli-test-home-"));
    const sessions = mkdtempSync(join(tmpdir(), "dsh-mini-cli-test-sessions-"));
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        DSH_PLAIN: "1",
        DSH_NO_BANNER: "1",
        DSH_FAKE_LLM: "1",
        DSH_PROVIDER: "fake",
        DSH_SESSIONS: sessions,
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const sessionFiles = [];
      const walk = (dir) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else sessionFiles.push(path);
        }
      };
      walk(sessions);
      resolve({ code, signal, out, err, sessionFiles });
      rmSync(home, { recursive: true, force: true });
      rmSync(sessions, { recursive: true, force: true });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

test("piped multi-line session is fully consumed and exits 0", async () => {
  const r = await runCli("hello one\nhello two\n/stats\nexit\n");
  assert.equal(r.signal, null, `killed by signal: ${r.err}`);
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
  // Both prompt lines must reach the fake model; a swallowed-line bug
  // would produce fewer than two replies.
  const replies = (r.out.match(/\(default reply\)/g) || []).length;
  assert.ok(replies >= 2, `expected at least 2 model replies, got ${replies}: ${r.out.slice(0, 600)}`);
  assert.match(r.out, /turns=2/);
  assert.doesNotMatch(r.out, /NO_ADAPTER|MISSING_CREDENTIAL/);
});

test("bare /provider is intercepted and never reaches the model", async () => {
  const r = await runCli("/provider\nexit\n");
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
  assert.match(r.out, /providers:/);
  assert.doesNotMatch(r.out, /\(default reply\)/);
});

test("/exit does not fall through to the model", async () => {
  const r = await runCli("/exit\n");
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
  assert.doesNotMatch(r.out, /\(default reply\)/);
});

test("exit flushes the session to disk", async () => {
  const r = await runCli("hello fake\nexit\n");
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
  assert.ok(r.sessionFiles.length > 0, "expected at least one persisted session file");
  assert.ok(r.sessionFiles.every((path) => path.endsWith(".jsonl") || path.endsWith(".zstd")), `unexpected session files: ${r.sessionFiles.join(",")}`);
});

test("stdin EOF after queued piped input exits cleanly without /exit", async () => {
  // Write immediately and close stdin before the REPL necessarily arms:
  // queued lines must still be consumed and EOF must terminate the process.
  const r = await runCli("hello eof one\nhello eof two\n");
  assert.equal(r.signal, null, `killed by signal: ${r.err}`);
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
  const replies = (r.out.match(/\(default reply\)/g) || []).length;
  assert.equal(replies, 2, `expected both EOF-queued prompts to be consumed: ${r.out.slice(0, 600)}`);
});

test("--sessions smoke with fake provider exits 0", async () => {
  const r = await runCli("", ["--sessions"]);
  assert.equal(r.code, 0, `stderr: ${r.err.slice(0, 1000)}`);
});
