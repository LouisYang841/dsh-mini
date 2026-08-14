# Operit 集成 — DSH 大脑 + Operit 触手

> **进度 (v0.1.10, 2026-08-14)**: 路线 A 的 M1+M2 已代码完成并 Node 侧验证
> 通过——`operit/` 把引擎注册为 Operit AI provider，DeepSeek 走 OkHttp 流式，
> 假 provider 回放（todo 工具调度）+ 真 API 冒烟双过。产物
> `dshmini.toolpkg.zip`（~200KB）挂在 release 上，手机上用 Operit 包安装
> 即可，无需重编 APK。剩：设备侧安装联调 + 工具名核对。
>
> 目标：把 dsh-mini 的便携引擎塞进 Operit，让 DSH agent 直接使用 Operit
> 已有的能力（终端、UI 树、Android 工具、网络、本地模型）作为"手"，
> 我们**不重写任何操作手机的工具**。引擎一行不改，只写宿主胶水。

## 现状盘点（已核实）

| 我们这边 | 状态 |
|---|---|
| 便携引擎 bundle.mjs（419KB） | ✅ 已在 QuickJS 下字节级一致（conformance 门） |
| 引擎核心网络依赖 | ✅ 零（LLM 适配器由宿主注入，`node:http`/fetch 均不在引擎里） |
| JSONL 持久化无 zstd 路径 | ✅ 已支持（`compression:"none"`） |
| shims 大声失败桩 | ✅ 缺的功能优雅降级，不会拖垮整个 agent |

| Operit 那边（app/src/main/assets + plugins） | 用途 |
|---|---|
| `bridge/index.js` + `bridge/spawn-helper.js` | **JS 起进程 = 终端触手**（缝③的宿主实现） |
| `js/AndroidUtils.js`、`js/UINode.js`（无障碍树）、`js/OkHttp3.js` | 系统工具、UI 自动化、HTTP（缝①/③的原料） |
| `api/chat` + `plugins/toolpkg` 的 `AITool`/`ToolExecutor`/`ToolInvocation`/`ToolResult` | Operit 自有的工具执行框架（宿主可选走这条路） |
| `llm/`（llama、mnn） | 本地模型 provider（缝①的另一条路：离线跑） |

## 触手模型（五条缝在 Operit 里的落点）

```text
DSH 引擎（bundle.mjs，QuickJS，不动）
 ├─ ① llm adapter   → 云：OkHttp3.js 上的 SSE 适配器（参考我们的 DeepSeek 适配器）
 │                    本地：Operit llama/mnn provider
 ├─ ② fs service    → AndroidUtils / 原生存储桥（接口形状照抄 cli/node-fs.js 契约）
 ├─ ③ exec/bash 工具 → spawn-helper.js（pi 的 executeBashWithOperations 语义原样复刻）
 │                    加分触手：UINode.js 无障碍树 = 点击/滑动/读取屏幕（额外工具，不进引擎）
 ├─ ④ persistence   → JSONL 无压缩，存 Operit 文件空间
 └─ ⑤ 引擎面        → bundle.mjs 原样（shims/polyfills 已就位）
```

**两条集成路线**（开工时二选一，都不改引擎）：

- **路线 A：DSH 引擎独立跑，工具全走 bridge**。我们在 QuickJS 里 boot
  引擎（`main.js` 的 boot 参考直接搬），bash 工具调 spawn-helper，fs 调
  AndroidUtils。优点：结构完全照搬 CLI，一致性门原样可跑；Operit 只是宿主。
- **路线 B：DSH 工具注册进 Operit 的 ToolExecutor 框架**。DSH 的
  `defineTool` 包一层 `ToolInvocation/ToolResult` 桥，Operit 的 chat 管道
  （ToolPkgChatInputHookBridge 等）驱动 DSH 引擎。优点：吃 Operit 现成的
  权限/生命周期/UI；代价：要多理解它 hook 管道的时序。

## 里程碑（触手已算白送后）

| # | 内容 | 估时 |
|---|---|---|
| M1 | 引擎入 Operit：假 provider 跑通完整 turn + 一致性门场景 | 2-3 天 |
| M2 | 真 LLM：云 API 走 OkHttp3 SSE（流式）；可选接 llama/mnn 本地 | 1-3 天 |
| M3 | 触手接线：spawn-helper 版 bash 工具 + fs + JSONL 持久化 + todo/goal | 3-5 天 |
| M4 | 体验：chat UI 宿主、clarify 弹层、会话选择、UINode 触手（可选） | 1-2 周 |

合计：**约 2-3 周出"手机上能干活、用终端和 UI 树当手的 DSH agent"**。

## 开工前要钉死的三个问题

1. **Operit 的 QuickJS 版本与 es2016 降级**：我们的 ALS 前奏依赖
   `--target=es2016`（async 降级成 generator + patched `then`）。确认它的
   QuickJS 支持同款降级输出，否则换引擎启动路径。
2. **spawn-helper.js 的 API 形状**：参数/输出流/退出码/超时/取消语义——
   pi 的 bash 工具契约要照它重写一次（缝③允许宿主重实现）。
3. **SSE 流式**：OkHttp3.js 能否增量吐出 chunk（决定 M2 是一天还是一周）。

## 验收标准（沿用一致性门）

Operit 里跑 `main.js` 的假 provider 场景，事件序列与
`baseline.node.json` **字节级一致** = 引擎未损伤的客观证明。这一步过了，
后面所有问题都只可能是宿主问题，不是脑子问题。
