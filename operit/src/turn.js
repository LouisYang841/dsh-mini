// One DSH turn driven from Operit's sendMessage: followup + whenIdle,
// with incremental chunks relayed to the chat UI via
// sendIntermediateResult({ chunk }) and tool progress echoed as dim notes.

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { appendSessionEvents } from "./store.js";

function norm(value) {
	return value == null ? "" : String(value);
}

function relayChunk(chunk) {
	if (typeof sendIntermediateResult === "function" && chunk) {
		try {
			sendIntermediateResult({ chunk });
		} catch {
			// UI relay is best-effort
		}
	}
}

export async function driveTurn(engine, userText) {
	const { agent } = engine;
	const message = createUserMessage({
		content: [{ type: "text", text: userText }],
		source: { kind: "user" },
	});

	// Event relay: poll the session for new events while the turn runs.
	// NOTE: the session splices its event list during a turn (inbox/spliced),
	// so always re-read agent.session.events — never cache the array.
	let relayed = agent.session.events.length;
	let stopped = false;
	const poller = (async () => {
		while (!stopped) {
			const events = agent.session.events;
			for (let i = relayed; i < events.length; i++) {
				const event = events[i];
				if (event.type === "assistant/chunk") {
					const chunk = event.data?.chunk;
					// Stream text-delta increments; block-end carries the FULL
					// block again, so relaying it would double-print.
					if (chunk?.type === "text-delta" && chunk.text) relayChunk(chunk.text);
					else if (chunk?.type === "reasoning-delta" && chunk.text) relayChunk(chunk.text);
				} else if (event.type === "tool/start" || event.type === "tool/update") {
					const name = norm(event.data?.name);
					if (name) relayChunk(`\n⏳ tool: ${name}`);
				} else if (event.type === "tool/result") {
					relayChunk(` ✔`);
				}
			}
			relayed = events.length;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	})();

	try {
		agent.followup(message);
		await agent.whenIdle();
	} finally {
		stopped = true;
		await poller;
	}

	// Best-effort durable log: persistence must never break the turn.
	try {
		await appendSessionEvents(engine);
	} catch (error) {
		if (typeof console !== "undefined" && console.warn) {
			console.warn("[dshmini] session persist skipped:", String(error?.message || error));
		}
	}

	// Collect the latest turn's final text (block-end only — complete and
	// deduplicated) plus usage from the usage chunk.
	let text = "";
	let usage = { input: 0, output: 0 };
	let lastTurn;
	for (const event of agent.session.events) {
		const turn = event.data?.turn;
		if (turn !== undefined && (lastTurn === undefined || turn > lastTurn)) lastTurn = turn;
	}
	for (const event of agent.session.events) {
		if (lastTurn !== undefined && event.data?.turn !== lastTurn) continue;
		if (event.type !== "assistant/chunk") continue;
		const chunk = event.data?.chunk;
		if (chunk?.type === "block-end" && chunk.block?.type === "text") {
			text += chunk.block.text ?? "";
		} else if (chunk?.type === "usage") {
			const u = chunk.usage ?? {};
			usage = {
				input: usage.input + (Number(u.inputTokens ?? u.input ?? 0) || 0),
				output: usage.output + (Number(u.outputTokens ?? u.output ?? 0) || 0),
			};
		}
	}
	return { text, usage };
}
