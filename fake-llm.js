// Fake LLM cordis service — scripted chunk streams, no network.
// main.js stages scenario scripts in globalThis.__FAKE_STEPS; each
// stream() call consumes the next script. This is the SAME contract the
// real adapters (dsh-llm-deepseek / dsh-llm-pi-ai) satisfy.
import { Service } from "@deepseek-ai/cordis";

const DEFAULT_SCRIPT = {
	chunks: [
		{ type: "block-start", index: 0, blockType: "text" },
		{ type: "text-delta", index: 0, text: "(default reply)" },
		{ type: "block-end", index: 0, block: { type: "text", text: "(default reply)" } },
		{ type: "finish", reason: { kind: "stop" } },
	],
};

export class FakeLlm extends Service {
	constructor(ctx) {
		super(ctx, "llm");
	}
	async prepareCall(config) {
		// The adapter contract: prepareCall binds the config and returns a
		// prepared call handle carrying the stream() that executes it.
		const llm = this;
		return {
			config,
			stream: (request) => llm.stream(request),
		};
	}
	stream() {
		const steps = globalThis.__FAKE_STEPS ?? [];
		const script = steps.length > 0 ? steps.shift() : DEFAULT_SCRIPT;
		const chunks = (typeof script.chunks === "function" ? script.chunks() : script.chunks).slice();
		if (script.onStream) script.onStream();
		let i = 0;
		// Manual async iterator (no async generators: keeps the bundle
		// portable across engines without relying on generator lowering).
		return {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						if (i < chunks.length) return { value: chunks[i++], done: false };
						return { done: true };
					},
				};
			},
		};
	}
}
export default FakeLlm;
