# REFLECTION — 拼装与砍依赖的数字账

> 截至 v0.1.9。回答两个问题：**完全不写代码我们能砍掉多少依赖？**
> **我们写了多少代码，分别砍掉了哪些依赖？**

## 零代码基线：什么都不写会发生什么

"只拼装、不写一行代码"在 DSH 这里是不成立的——官方仓库**没有终端宿主**：

| 项目 | 数字（实测） |
|---|---|
| 官方安装树 | **255 个包 / 359MB** node_modules（其中 @deepseek-ai 196 个） |
| 可用的官方宿主 | apps/cli + launcher + profile/bundle/patch 启动机制（约 2000 行胶水） |
| 官方宿主自带原生大头 | node-pty、landlock、`@vscode/ripgrep`、chokidar、yaml、MCP SDK、koffi |
| 终端 UI | 无（还是要自己写） |
| Termux / QuickJS 便携路径 | 无 |

**结论：零代码 = 砍 0%。** 拿到手的就是 255 包全家桶 + 全部原生大头，
还缺手机壳和终端 UI。所有"砍"都发生在我们写胶水的地方。

## 我们写了多少

| 区域 | 行数 | 内容 |
|---|---|---|
| `cli/` | 1,560 | 宿主启动 cli.js 673 · Gemini 适配器 263 · node-fs 契约参考 141 · 横幅 130 · bash 胶水 126 · basic TUI 110 · skill 扫描器 78 · 构建脚本 39 |
| `shims/` | 737 | **19 个 node:\* API 的纯 JS 实现/大声失败桩**（path/util/util_types/crypto/async_hooks/module/events/perf/timers/os/fs/fs-promises/buffer + url/stream/zlib/worker_threads/child_process/sqlite 桩） |
| `polyfills.js` + `main.js` | 539 | 引擎差异归一化（QuickJS/V8）+ 假 provider 一致性场景 |
| `patches/` + `scripts/` + 根脚本 | 273 | 确定性 vendor 补丁 + 安装器 + 构建/一致性门 |
| **手写合计** | **3,109** | |
| `vendor-pi/`（pi 原生逐字 vendor，非手写） | 542 | MIT 归属头 + 只改 import 路径 |
| 文档（skills/架构/决策/路线图等） | 1,049 | 给 agent 的文档胜过给 agent 的工具 |

## 每一块代码砍掉了什么

| 我们写的 | 行数 | 替代掉的官方依赖 |
|---|---|---|
| env 加载器（cli.js 内） | 15 | `dsh-credentials-local` 的 **chokidar + yaml** 大头 |
| `cli/skill-scanner.js` | 78 | `dsh-skill-filesystem` 的 **chokidar + yaml** 大头 |
| `vendor-pi/`（pi 原生逐字复用） | 542 | 官方 shell/sandbox 栈的 **node-pty + landlock** 原生插件 |
| 终端优先——不写 grep 工具 | 0 | **`@vscode/ripgrep`** 原生包（bash 已覆盖） |
| `shims/` + `polyfills.js` | 1,082 | **19 个 node:\* 内置的运行时依赖** → 引擎在 QuickJS 上零内置运行 |
| `cli/node-fs.js` | 141 | seam ② 契约参考；`dsh-fs-local` 被采用（koffi 仅 Windows 惰性 import，Linux/Termux 等效纯包） |
| 不挂 MCP 插件族 | 0 | **MCP SDK** 全家 |
| `cli/cli.js` boot | 673 | 官方 launcher/profile/bundle/patch 启动机制（约 2000 行胶水） |

## 对比：从完整版 DSH 砍（fork-and-cut） vs 从内核拼（我们）

用户问题原文："从 dsh 装个 tui 然后砍一堆功能，哪个更好？" 两条路的账：

| 维度 | A：fork 完整版 + 装 TUI + 砍功能 | B：assemble（我们） |
|---|---|---|
| 要写/改的代码 | 删 79 个包（web UI 40 + 工具族 17 + 会话附加 14 + web 宿主 8）≈ launcher/profile 编辑 **200-400 行**；**仍要写终端宿主 ~800 行**（官方无 TUI）；**仍需写凭证 UI** | 3,109 行（其中产品 UX ~1/3、可移植层 ~1/3） |
| 砍后残留 | ~176 包 / **250MB+**（估算：官方均包重大），node_modules 运行时 | 168 包构建闭包 / 161MB，**运行时 0 包** |
| 原生大头 | node-pty、landlock、ripgrep、koffi、chokidar **删不掉**——它们焊在 bash/sandbox/grep/凭证功能里，删 = 重写这些功能 | 0（pi 复用 542 行 + 终端优先，正是"重写"那部分） |
| Termux | ❌ 原生模块要编译、ripgrep 是二进制、koffi 要 FFI | ✅ |
| QuickJS 便携引擎 | ❌ Node-only，删包删不出可移植性 | ✅ 419KB，字节级一致 |
| 上游升级 | 持续 rebase 官方 fork | npm 锁版本 + 一致性门自动守 |
| 功能面 | 全（web/MCP 也在） | 31 个插件（我们只留终端需要的） |

**结论**：fork 路线的"便宜"只有删除本身（删包几乎不写代码）；但它的两大成本
永远绕不开——(1) 原生大头砍不掉（除非重写那些功能，那就是我们写的这部分代码）；
(2) 可移植性根本不在菜单上。**如果目标是桌面 Node-only 全功能版，A 略省 500-1000
行；如果目标是手机/便携（我们的目标），A 写再多也到不了 B 的位置。**

## 砍依赖的"性价比"排序（每行代码砍掉的依赖）

| 手段 | 我们写的代码 | 砍掉的 |
|---|---|---|
| 终端优先（不写 grep 工具） | **0 行** | `@vscode/ripgrep` 原生包 |
| 不挂 MCP 插件族 | **0 行** | MCP SDK 全家 |
| pi 原生 bash executor 逐字 vendor | 0 行手写（542 行复用） | node-pty + landlock 原生插件 |
| env 加载器 | 15 行 | chokidar + yaml（dsh-credentials-local） |
| skill 扫描器 | 78 行 | chokidar + yaml（dsh-skill-filesystem） |
| 删 pi-ai + 社区 TUI（实测） | ~30 行（改挂载） | 闭包 168→63 包、161→29MB、**产物 7.7→1.89MB** |
| shims + polyfills | 1,082 行 | 19 个 node:\* 内置（买的不是依赖，是 QuickJS 可移植性） |

**能砍到什么地步（实测下限）**：摘掉 pi-ai（5 家云 SDK）和社区 TUI（react 栈）
两个大头后——构建闭包 **63 包 / 29MB**，产物 **1.89MB**（仍含 basic TUI、引擎、
goal/todo/ask-user/bash 全部功能）。再往下就是引擎内核 13 包 + 我们挂的 30 个小头，
纯 JS 无原生，**没有更多"大头"可砍了**——剩下的都是我们主动保留的功能。

## 为什么 3,109 行不算多

- 官方 boot 机制单独就 ~2000 行（ADR-0001）；我们整个宿主 673 行
- 1/3 是可移植层（shims+polyfills 1,082 行）——买 QuickJS/419KB 引擎；不要便携目标可删
- 1/3 是产品 UX（TUI、横幅、clarify 打字、resume 修复、补丁）——任何终端 agent 都要写
- 依赖层面的砍几乎免费（大头砍都是决策，不是代码）；代码买的是**功能与可移植性**

## 现在的数字

| | 官方 DSH | dsh-mini |
|---|---|---|
| 构建期直接依赖 | — | **39 个**（34 个 @deepseek-ai 小头 + schemastery + pi-ai + pi-tui + dsh-tui + esbuild） |
| npm 实际安装闭包 | 255 包 / 359MB | **168 包 / 161MB**（其中大头：@mistralai 25M、openai 14M、@google 14M、@aws-sdk 8.7M、@smithy 8.5M、@anthropic-ai 6.7M ≈ 77MB 全是多 provider SDK） |
| 挂载插件 | ~90 | **31 个**（全纯 JS，零原生模块） |
| 运行时 npm 依赖 | 全家桶 | **0 个** |
| 产物 | — | **7.7MB** CLI（≈47 倍缩减）+ **419KB** 便携引擎 |

## 诚实的注脚 + 下一个可砍清单

1. **构建期闭包还有 168 包**——这是"小头优先"策略的代价：社区 TUI 拖
   react 栈，`dsh-llm-pi-ai` 静态 import 了 5 家云 SDK（约 77MB 安装体积，
   且其中部分进了 7.7MB 产物）。但**一个字节都不发货到运行时**。
2. **下一个砍点（按 ROI 排序）**：
   - pi-ai 的 provider SDK 按"环境变量存在才 import"懒加载 → 产物预计再缩
     数 MB；
   - pi-tui 的 react 壳换 basic TUI 时构建期可少 20MB+；
   - @google/genai 只在 Gemini 适配器（我们自己的）用到时保留。
3. **哲学没变**：我们只写了 3,109 行，砍掉的都是"大头"，留下的全是纯 JS
   小头；拼装和解耦才是主工作，引擎一行没改（一致性门字节级守门）。
