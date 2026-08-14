# dsh-mini

[![CI](https://img.shields.io/github/actions/workflow/status/LouisYang841/dsh-mini/conformance.yml?branch=main&label=conformance)](https://github.com/LouisYang841/dsh-mini/actions)
[![version](https://img.shields.io/github/v/release/LouisYang841/dsh-mini?label=release)](https://github.com/LouisYang841/dsh-mini/releases/latest)
[![stars](https://img.shields.io/github/stars/LouisYang841/dsh-mini)](https://github.com/LouisYang841/dsh-mini)
[![license](https://img.shields.io/github/license/LouisYang841/dsh-mini)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.15-brightgreen)](#termux-android)
[![runtime deps](https://img.shields.io/badge/runtime%20npm%20deps-0-brightgreen)](#依赖砍了多少)
[![Termux](https://img.shields.io/badge/Termux%20verified-3DDC84?logo=android)](#为什么对termux友好)

**DeepSeek Harness 核心的便携引擎 + 一个能在手机上干活的终端编程 Agent CLI。** 我们不是 fork：以 npm 消费者身份把 pi（壳）和 DSH（引擎）拼在一起，本仓库真正自研的是**五条缝、兼容层和文档**——拼装与解耦。

## 这是什么

- **引擎原样来自 DSH 官方包**：事件溯源会话、turn/step 状态机、工具调度、压缩、skills——`@deepseek-ai/dsh-*` 锁版直用，一行不改
- **壳来自 pi 生态**：真 `@earendil-works/pi-tui` 框架 + 社区 `@openguardrails/dsh-tui` 全屏界面（默认）
- **我们能替换的只有缝**：provider 换、文件系统换、持久化换、UI 换，引擎不动

## 依赖砍了多少

| | 官方 DSH | dsh-mini |
|---|---|---|
| @deepseek-ai 包 | 188 个 | 构建期 13 个（+ pi-tui 1 个） |
| 默认 profile 插件 | ~90 个 | ~27 个（全纯 JS，零原生模块） |
| 运行时 npm 依赖 | 全家桶 | **0 个**（产物自包含） |
| 安装体积 | **359MB** node_modules | **7.6MB 单文件**（约 47 倍缩减） |
| 便携引擎 | — | **419KB**，零 Node 内置依赖 |

数字来源：官方安装的 node_modules 实测 359MB；我们的构建期依赖只保留直接 import 的 14 个包（全部 devDependencies，`npm install --omit=dev` 装 0 个）。

## 为什么对 Termux 友好

- **唯一运行时要求：Node ≥ 22.15**——zstd 内置于 `node:zlib`，无原生模块、无编译
- **一条命令安装**：`curl | sh`，下载单个 7.6MB 自包含文件 + 26 行 launcher，npm 都不需要
- **bash 工具直接打手机真实文件系统**（OnePlus 15 / Termux 实测：ls、建文件、跑脚本）
- **为 Android 修过的真坑**（skill 里有记录）：SELinux 禁硬链接 → 持久化降级为 rename 原子发布；`exit` 与 200ms 写批的时序 → 退出前强制 flush
- **数据和密钥都在手机本地**：会话 JSONL 在 `~/.dsh-mini/sessions`，密钥可从本机 pi 配置导入、不出设备
- 三套界面按环境自适应：默认全屏 TUI / `DSH_TUI=basic` 简易壳 / `DSH_PLAIN=1` 纯文本（管道与脚本友好）

## pi 和 DSH 是怎么低耦合焊在一起的

五条缝（完整契约见 `ARCHITECTURE.md`）：

1. **LLM 适配器**——DSH 官方 DeepSeek 直连 + 官方 pi-ai 多 provider（OpenAI/Anthropic/OpenRouter，环境变量存在即启用）+ 自写 Gemini 作为缝的参考实现
2. **文件系统服务**——官方 `dsh-fs-local`（koffi 仅 Windows 惰性加载，Linux/Termux 等效纯包）；`node-fs.js` 是非 Node 宿主的契约参考
3. **持久化后端**——官方 JSONL 后端 + 我们的 `shims/fs-promises.js` 兼容层（Android 专属修复）
4. **Node API 面 shims**——纯 JS 重实现 + "大声失败"桩：核心一旦越界立刻报错
5. **引擎面 polyfills**——QuickJS/V8 等引擎差异归一化（同 bundle 在 Node 与 QuickJS 上产生**字节级一致**的事件序列）

## 这个 repo 如何支持再拼装与扩展

- `ARCHITECTURE.md`：五缝 + 六步改装配方——把引擎装进任何 harness/agent app
- `DECISIONS.md`：ADR-0001（为什么组装而不是 fork 官方）+ ADR-0002（砍大头留小头判据）
- `skills/`：近 50 条实踩坑（cordis 语义、引擎差异、Android、配额、发布），agent 可通过内置 `skill` 工具现场加载
- **conformance 门**：假 provider 回放 + 字节级基线（`run.sh`）——上游升版、引擎改动全有客观验收，且零 API 配额
- `AGENTS.md`：给任何 coding agent（包括 dsh-mini 自己）的工程规矩

## 快速开始

```sh
# 任意 Node ≥ 22.15 机器（Termux 先 pkg install nodejs）
curl -fsSL https://github.com/LouisYang841/dsh-mini/raw/main/scripts/install.sh | sh
dsh-mini
```

首次运行无密钥会交互询问 provider 并持久化（`~/.dsh-mini/env`）。DeepSeek 默认；`/provider` 切换，`/model` 换型号，`--resume`/`--sessions` 回访会话。

## 许可证

自身代码 MIT；全部拼装组件的归属声明见 `THIRD_PARTY_LICENSES.md`（随 release 分发）。

---

以下为英文文档（架构细节、开发指南）。

This directory is the spike that answers one question: **can the DeepSeek
Harness core be pulled from npm, run as a self-contained engine behind a
compatibility layer, and be embedded in other hosts?**

Two deliverables:

## 1. Engine spike (`bundle.mjs`, `run.sh`)

The real DSH core — cordis + `AgentRegistry` + `SessionStore` + `SystemPrompt`
+ `ToolRuntime` + `AgentLoop` (the event-sourced turn/step state machine) —
bundled into ONE engine-agnostic file (~419 KB, zero Node builtins) with:

- `shims/` — the Node builtin surface reimplemented in pure JS (`path`,
  `util`, `crypto`, `async_hooks`/AsyncLocalStorage via a patched promise
  chain, …). fs/sqlite/child_process are loud-failure stubs: if the core ever
  touches them, it fails loudly instead of misbehaving.
- `polyfills.js` — engine polyfills (AbortController, structuredClone,
  Promise.withResolvers, Symbol.dispose, …) plus one engine-difference
  normalization: QuickJS renders `Function.prototype.toString` of native
  functions multi-line while `dsh-tools` string-compares the V8 single-line
  form.

Key design choice: esbuild `--target=es2016` LOWERS async/await to generators
so every promise continuation passes through JS-visible `Promise.prototype.then`
— required for the AsyncLocalStorage prelude to work on QuickJS, whose `await`
is C-internal.

Validation: 5 scripted scenarios (plain text / tool round-trip /
parallel+exclusive tool scheduling / max-tokens truncation / mid-turn
steering) replay through a fake provider. Node and QuickJS produce
**byte-identical** event traces (114 events), hash-pinned in
`baseline.node.json` + `baseline.sha256`. Every future `@deepseek-ai/*`
upgrade must pass `./run.sh`.

## 2. dsh-mini CLI (`cli/`)

The same DSH core as a real interactive coding agent on Node:

```
node cli/cli.mjs [model]
```

- Provider: Google Gemini via the AI Studio SSE endpoint, implemented as a
  `dsh-llm` `LlmAdapter` (`cli/gemini-adapter.js`) — proof that a third-party
  provider plugs into the core through the adapter seam. Includes the
  Gemini-3 `thoughtSignature` echo quirk (signatures are part-level siblings
  of `functionCall` in both directions).
- Tools: the REAL `dsh-tool-fs` tools (read/write/edit/list) + `dsh-tool-todo`,
  backed by a minimal node:fs implementation of the dsh `fs` service
  (`cli/node-fs.js`).
- Persistence: the REAL DSH JSONL backend (`dsh-session-persistence-jsonl`,
  zstd, per-cwd layout); sessions survive restarts, `--resume <id>` resumes,
  `--sessions` lists. Verified cross-process memory (secret-code test).
- REPL: `/clear`, `/model <id>`, `/sessions`, `/exit`; live event rendering
  from the session firehose; ANSI status bar with live token usage.

Commands:
```
cli/cli-build.sh          # build cli/cli.mjs (Node profile)
./run.sh                  # engine conformance (Node + QuickJS, diff vs baseline)
./build.sh                # portable engine bundle only
node cli/cli.mjs [model] [--resume <id>] [--sessions]   # DSH_SESSIONS overrides the sessions dir
```

**Providers.** DeepSeek is the default (`deepseek-official` route via DSH's own
`dsh-llm-deepseek` adapter; `DEEPSEEK_API_KEY`), Google Gemini via
`GEMINI_API_KEY`. The pi provider ecosystem rides one adapter
(`dsh-llm-pi-ai`): set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
`OPENROUTER_API_KEY` and the `openai` / `anthropic` / `openrouter` routes
light up automatically (plus the pi-ai `deepseek` route). Switch with
`/provider <id>`, models with `/model <id>`.
**First run with no keys anywhere starts an interactive setup**: pick a
provider, paste the key — it is persisted to `~/.dsh-mini/env` (fallback
`./.env`, both gitignored) and loaded automatically on the next start.
**Workspace instructions**: if the working directory contains an `AGENTS.md`,
it is injected into the system prompt (`DSH_NO_AGENTS=1` disables).

Architecture (engine/host seams, retrofit recipe, upgrade policy):
`ARCHITECTURE.md`. Pitfalls and host-integration checklist:
`skills/dsh-core-embedding/SKILL.md`.

## Install (one-liner)

```sh
curl -fsSL https://github.com/LouisYang841/dsh-mini/raw/main/scripts/install.sh | sh
```

Installs `dsh-mini` as a command (bundle to `~/.dsh-mini/`, launcher on
PATH). Requires Node >= 22.15. On Termux: `pkg install nodejs` first.

## Termux (Android)

The release artifact is fully self-contained — no npm install needed (also
verified live on a OnePlus 15: setup → bash tool driving the phone's real
filesystem → session persisted, all on-device):

**Renderer modes**: on a real terminal the full-screen pi-tui shell
(`@openguardrails/dsh-tui`, Claude-Code style) is the DEFAULT;
`DSH_TUI=basic` gets the minimal chat-flow shell, `DSH_PLAIN=1` (or pipes)
gets plain line mode for scripts/CI.

```sh
pkg install nodejs            # Node >= 22.15 (zstd is bundled in node:zlib)
curl -LO https://github.com/LouisYang841/dsh-mini/releases/latest/download/dsh-mini.mjs
export GEMINI_API_KEY=<your AI Studio key>
node dsh-mini.mjs             # pi-tui shell; the bash tool hits Termux's real bash
```

Sessions persist under `~/.dsh-mini/sessions` (zstd JSONL; automatically
falls back to uncompressed on Node < 22.15). Building from source on Termux:
`npm install --ignore-scripts` (skips node-pty/koffi build steps — neither is
needed at runtime: the bash tool uses plain child_process, and koffi is a
Windows-only dynamic import in the persistence backend), then
`bash cli/cli-build.sh`; esbuild's android-arm64 binary arrives via its
optionalDependencies.

## Releases

Each GitHub release attaches `dsh-mini.mjs` (self-contained CLI) and
`dsh-engine.mjs` (the portable engine bundle). Only tag after the CI
conformance gate is green.

## Consumption modes (zero runtime npm dependencies)

The package manifest carries **no runtime dependencies** — the release
artifacts are fully self-contained. Pick the mode that fits:

1. **CLI artifact** (recommended): `curl -LO` the release `dsh-mini.mjs` and
   run it with Node >= 22.15. No npm install, no DSH package tree.
2. **Engine-only**: take `dsh-engine.mjs` + `shims/` + `polyfills.js` (all
   plain files) into your own harness; `main.js` is the boot reference and
   `baseline.node.json` the conformance gate. No npm install either.
3. **Source build**: `git clone` + `npm install` (build-time devDependencies
   only) + `bash cli/cli-build.sh`. Add `--omit=dev` and nothing gets
   installed at all; add `--ignore-scripts` on Termux.

## CI

`.github/workflows/conformance.yml` runs on every push: npm install → portable
bundle build → conformance gate (byte-identical vs `baseline.node.json`) →
CLI build.

## Roadmap

Feature audit with sourcing decisions (pi-native → DSH minimal → self-written
glue), priorities, and a deliberate skip list: `ROADMAP.md`. Next up: the
pi-ai multi-provider adapter (seam ①), then pi-tui Markdown/autocomplete.
