# dsh-mini for Operit — 集成说明

把 dsh-mini 的便携引擎注册为 Operit 的 **AI provider**：DSH 官方 agent loop
跑在 Operit 的 JS 运行时里，工具走 Operit 的触手（终端/文件/网络），
UI 是 Operit 的聊天界面。引擎一行未改（一致性门守门）。

## 已验证（Node mock + 真 QuickJS）

`node mocks/smoke.mjs`（需 DEEPSEEK_API_KEY）+ `./quickjs-2026-06-04/qjs -m mocks/qjs-smoke.mjs`：
- 场景 A：假 provider 回放 → 引擎 + todo 工具全链路（`todo/write` 事件）
- 场景 A2：exec 工具走 mock `terminal` 桥 → 输出进入 `tool/result`
- 场景 A3：会话事件持久化为 **JSONL（无 zstd）**，重启后可从日志读回
- 场景 B：真 DeepSeek API 走 mock OkHttp 流式传输 → 完整回复 + chunk 转发
- QuickJS：引擎 + 工具调度在真 QuickJS 上跑通（最接近 Operit 运行时）
- 构建产物 `dist/main.js` ≈ 1.0MB（commonjs, es2016——ALS 前奏要求 async 降级）

**持久化现状**：`src/store.js` 通过 Operit 文件工具（write_file/
read_file_full/file_exists）把会话事件追加写入
`dshmini/sessions/main.jsonl`（read-modify-write，保留最近 4000 条，
失败不阻断 turn）。这是"数据级"持久化；**恢复连续会话**（重启后把日志
重建为活 agent）需要 SessionPersistence 服务契约——Operit 的 QuickJS
无同步 fs，官方 jsonl 插件跑不了，下一步自写最小契约实现。

## 装进 Operit（两步，无需重编 APK）

1. **打包工具包 zip**：
   ```sh
   cd spike/operit
   zip -r dshmini.toolpkg.zip manifest.json dist/main.js
   ```
2. **在手机上用 Operit 的包安装工具**装这个 zip（PackageToolExecutor；
   market origin 路径），然后在 AI provider 设置里选 "DSH mini (DeepSeek)"，
   在 Operit 的 credential 设置里填 API Key（宿主配置，不写入任何源文件），
   再填 endpoint / modelName。

若包安装路径不可用（版本差异），fallback：把 `dist/main.js` + `manifest.json`
放进 `app/src/main/assets/` 对应的工具包目录重编 APK（重活用 AWS credit 开
临时大实例，用完 terminate）。

## 关键实现点（换设备时先看这里）

- **工具名映射**：`src/tools.js` 的 `OPERIT_TOOL_NAMES.exec = "terminal"`——取自
  Operit 权威工具表（assets/packages/super_admin.js）：Ubuntu proot 环境、
  sdcard/storage 已挂载；参数 `command` + `timeoutMs`（**字符串**，最低 3000）
  + `background`。mock 同名。
- **es2016 是硬要求**：`build.mjs` 的 target 不能升回 es2020——ALS 前奏依赖
  async 降级，否则工具调度静默失效（模型 tool call 被丢弃）。
- **传输层**：`src/llm-adapter.js` 用 Operit 的 `OkHttp` + `onIntermediateResult`
  流式；SSE 手写解析（无 Web Streams）。线格式与官方 dsh-llm-deepseek 一致。
- **单例引擎**：per apiKey+model 一个 context；换配置时 dispose 重建。
- **会话连续性**：agent 自己持有会话历史；sendMessage 只取最后一条 USER
  消息驱动新 turn，chatHistory 不回灌（避免双份历史）。
