// QuickJS verification of the Operit bundle (dist/main.esm.mjs): the same
// scenario A as mocks/smoke.mjs, but on a real QuickJS engine — the closest
// proxy to Operit's runtime available on the dev box. No Node globals are
// assumed; the fake adapter is a plain object implementing the LlmAdapter
// surface (no @deepseek-ai imports — QuickJS resolves no npm packages).

const FAKE_TODOS = JSON.stringify({ todos: [{ content: "one", status: "pending" }] });

globalThis.ToolPkg = {
	registerAiProvider() {
		globalThis.__dshProvider = true;
	},
};
globalThis.sendIntermediateResult = () => {};
globalThis.toolCall = async () => {
	throw new Error("toolCall is unused in scenario A");
};
globalThis.__DSH_FAKE_ADAPTER = () => ({
	providerInfo(provider) {
		return { id: provider, name: "fake" };
	},
	providerRetryPolicy() {
		return undefined;
	},
	resolveModel(provider, model) {
		return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100000 } });
	},
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
						{ type: "text-delta", index: 0, text: "done" },
						{ type: "block-end", index: 0, block: { type: "text", text: "done" } },
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
	},
});

const { registerToolPkg, bootDsh, driveTurn } = await import("../dist/main.esm.mjs");

async function main() {
	registerToolPkg();
	if (!globalThis.__dshProvider) throw new Error("QJS: provider registration failed");
	const engine = await bootDsh({ apiKey: "fake-key-123456", modelName: "fake-1" });
	globalThis.__STEP = 0;
	await driveTurn(engine, "create todos");
	const count = engine.agent.session.events.filter((e) => e.type === "todo/write").length;
	print("QJS todo/write events:", count);
	if (count !== 1) throw new Error(`QJS scenario A failed: expected 1 todo/write, got ${count}`);
	print("QJS PASS: engine + todo tool + turn machine on QuickJS");
}

main().then(
	() => {},
	(error) => {
		print("QJS FAILED:", error?.stack ?? String(error));
		if (typeof std !== "undefined" && std.exit) std.exit(1);
		throw error;
	},
);
