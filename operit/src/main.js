// Operit AI-provider entry for dsh-mini.
//
// Shape follows Operit's examples/custom_ai_provider: registerToolPkg()
// registers an AI provider whose sendMessage() receives the conversation
// and returns { text, usage }. The whole DSH turn machine runs inside
// sendMessage — Operit's chat pipeline is the UI, DSH is the brain.
//
// Verified on Node via mocks/ (same file, fake globals) before touching
// a device: mocks/smoke.mjs drives full turns against the real API.

import { bootDsh, isBooted, currentEngine } from "./engine.js";
import { driveTurn } from "./turn.js";
import { loadSessionEvents, sessionLogPath } from "./store.js";

const PROVIDER_ID = "dshmini_deepseek";
const PROVIDER_NAME = "DSH mini (DeepSeek)";

function norm(value) {
	return value == null ? "" : String(value);
}

/** Last USER turn content from Operit's chat history. */
function lastUserText(chatHistory) {
	const turns = Array.isArray(chatHistory) ? chatHistory : [];
	for (let i = turns.length - 1; i >= 0; i--) {
		const kind = norm(turns[i]?.kind).toUpperCase();
		if (kind === "USER") {
			const text = norm(turns[i]?.content).trim();
			if (text) return text;
		}
	}
	return "";
}

function resolveConfig(payloadConfig) {
	return {
		apiKey: norm(payloadConfig?.apiKey).trim(),
		apiEndpoint: norm(payloadConfig?.apiEndpoint).trim() || "https://api.deepseek.com",
		modelName: norm(payloadConfig?.modelName).trim() || "deepseek-chat",
	};
}

/** Send one chat turn through the DSH engine, streaming chunks to the UI. */
async function sendMessage(event) {
	const payload = event?.eventPayload ?? {};
	const config = resolveConfig(payload?.config);
	if (!config.apiKey) throw new Error("DSH mini: API Key 不能为空");
	const userText = lastUserText(payload?.chatHistory);
	if (!userText) return { text: "", usage: { input: 0, output: 0 } };

	const engine = await bootDsh(config);
	return await driveTurn(engine, userText);
}

function listModels() {
	return {
		models: [
			{ id: "deepseek-chat", name: "deepseek-chat" },
			{ id: "deepseek-reasoner", name: "deepseek-reasoner" },
		],
	};
}

async function testConnection(event) {
	const payload = event?.eventPayload ?? {};
	const config = resolveConfig(payload?.config);
	if (!config.apiKey) return { success: false, message: "API Key 不能为空" };
	try {
		const engine = await bootDsh(config);
		return {
			success: isBooted(),
			message: engine ? "DSH engine booted" : "DSH engine not booted",
		};
	} catch (error) {
		return { success: false, message: norm(error?.message || error) };
	}
}

function calculateInputTokens(event) {
	const history = event?.eventPayload?.chatHistory || [];
	let total = 0;
	for (const turn of history) total += norm(turn?.content).length;
	return { tokens: Math.max(1, Math.ceil(total / 4)) };
}

export function registerToolPkg() {
	ToolPkg.registerAiProvider({
		id: PROVIDER_ID,
		displayName: PROVIDER_NAME,
		description: "dsh-mini portable DeepSeek Harness engine as an Operit provider",
		listModels: { function: listModels },
		sendMessage: { function: sendMessage },
		testConnection: { function: testConnection },
		calculateInputTokens: { function: calculateInputTokens },
	});
	return true;
}

export { sendMessage, bootDsh, driveTurn, currentEngine, loadSessionEvents, sessionLogPath };
