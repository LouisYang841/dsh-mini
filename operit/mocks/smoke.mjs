// Verification harness: runs operit/dist/main.js under Node with Operit's
// globals faked (mocks/globals.mjs). Two scenarios:
//   A. fake-provider replay — scripted model calls todo_write; asserts the
//      engine + tool path work in the Operit boot configuration.
//   B. live DeepSeek turn — real API, no tools; prints relayed chunks.

import "./globals.mjs";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

process.env.NO_COLOR = "1";

const FAKE_TODOS = JSON.stringify({
	todos: [
		{ content: "one", status: "completed" },
		{ content: "two", status: "in_progress" },
		{ content: "three", status: "pending" },
	],
});

class FakeAdapter extends LlmAdapter {
	providerInfo(provider) {
		return { id: provider, name: "fake" };
	}
	resolveModel(provider, model) {
		return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100000 } });
	}
	stream() {
		const step = (globalThis.__STEP = (globalThis.__STEP ?? 0) + 1);
		const chunks =
			step === 1
				? [
						{ type: "block-start", index: 0, blockType: "tool-call" },
						{ type: "tool-call-delta", index: 0, id: "call-0", name: "todo_write", argumentsDelta: FAKE_TODOS },
						{ type: "block-end", index: 0, block: { type: "tool-call", id: "call-0", name: "todo_write", arguments: FAKE_TODOS } },
						{ type: "finish", reason: { kind: "stop" } },
					]
				: [
						{ type: "block-start", index: 0, blockType: "text" },
						{ type: "text-delta", index: 0, text: "todo list updated" },
						{ type: "block-end", index: 0, block: { type: "text", text: "todo list updated" } },
						{ type: "finish", reason: { kind: "stop" } },
					];
		let i = 0;
		return {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						return i < chunks.length ? { value: chunks[i++], done: false } : { done: true };
					},
				};
			},
		};
	}
}

// Load the commonjs bundle explicitly (spike's package.json is type:module,
// so Node insists on .cjs for a require of local files).
import { createRequire } from "node:module";
import { copyFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const bundlePath = new URL("../dist/main.js", import.meta.url).pathname;
const smokeCjs = bundlePath.replace(/\.js$/, ".smoke.cjs");
copyFileSync(bundlePath, smokeCjs);
const { registerToolPkg, bootDsh, driveTurn } = require(smokeCjs);

// ---- Scenario A: fake provider + todo tool ----
globalThis.__DSH_FAKE_ADAPTER = () => new FakeAdapter();
registerToolPkg();
if (!globalThis.__dshProvider) throw new Error("A: provider registration failed");

const engineA = await bootDsh({ apiKey: "fake-key-123456", modelName: "fake-1" });
globalThis.__STEP = 0;
await driveTurn(engineA, "create a todo list");
const todoWrites = engineA.agent.session.events.filter((e) => e.type === "todo/write");
console.log("\n[A] todo/write events:", todoWrites.length);
if (todoWrites.length !== 1) throw new Error("A: expected exactly 1 todo/write event");
console.log("[A] PASS: engine + todo tool + fake-provider turn");

// ---- Scenario B: live DeepSeek turn (no tools needed) ----
const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
	console.log("[B] SKIP: no DEEPSEEK_API_KEY in env");
	process.exit(0);
}
globalThis.__DSH_FAKE_ADAPTER = undefined;
const engineB = await bootDsh({ apiKey: key, modelName: "deepseek-chat" });
const result = await driveTurn(engineB, "Reply with exactly: hello from dsh-operit");
console.log("\n[B] final text:", JSON.stringify(result.text));
if (!result.text.includes("hello from dsh-operit")) throw new Error("B: unexpected reply: " + result.text);
console.log("[B] PASS: live DeepSeek turn through the mock OkHttp transport");
process.exit(0);
