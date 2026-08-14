// DeepSeek chat-completions adapter for Operit.
//
// The wire conversion (serializeMessages / translate / mapUsage) mirrors the
// official @deepseek-ai/dsh-llm-deepseek adapter line-for-line in logic; ONLY
// the transport differs: no fetch/Web Streams (QuickJS has neither) — the
// request goes through Operit's OkHttp client whose streaming execute()
// delivers {type:"chunk", chunk} events into onIntermediateResult.
//
// SSE parsing is hand-rolled over raw string chunks (TextDecoderStream and
// EventSourceParserStream are Web APIs we cannot assume).

import { CallId, LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";

function flattenText(blocks) {
	let text = "";
	for (const block of blocks) {
		if (block.type === "text") text += block.text;
	}
	return text;
}

function serializeAssistant(message) {
	const text = flattenText(message.content);
	const reasoning = message.content.filter((b) => b.type === "reasoning").map((b) => b.text).join("");
	const toolCalls = message.content.filter((b) => b.type === "tool-call").map((b) => ({
		id: b.id,
		type: "function",
		function: { name: b.name, arguments: b.arguments },
	}));
	return {
		role: "assistant",
		content: text,
		...(toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
		...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
	};
}

function serializeMessages(messages) {
	const wire = [];
	for (const message of messages) {
		if (message.role === "system") {
			wire.push({ role: "system", content: flattenText(message.content) });
			continue;
		}
		if (message.role === "assistant") {
			wire.push(serializeAssistant(message));
			continue;
		}
		const toolResults = message.content.filter((b) => b.type === "tool-result");
		const text = flattenText(message.content);
		if (text.length > 0 || toolResults.length === 0) wire.push({ role: "user", content: text });
		for (const result of toolResults) {
			wire.push({
				role: "tool",
				tool_call_id: result.toolCallId,
				content: flattenText(result.content) || "(no output)",
			});
		}
	}
	return wire;
}

function serializeRequest(options) {
	const messages = [];
	if (options.system !== undefined) messages.push({ role: "system", content: options.system });
	messages.push(...serializeMessages(options.messages));
	const tools = options.tools?.map((tool) => ({
		type: "function",
		function: { name: tool.name, description: tool.description, parameters: tool.parameters },
	}));
	return {
		model: options.model,
		messages,
		stream: true,
		stream_options: { include_usage: true },
		...(tools !== undefined && tools.length > 0 ? { tools } : {}),
		...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
		...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
		...(options.stop !== undefined ? { stop: options.stop } : {}),
	};
}

function mapFinishReason(reason) {
	switch (reason) {
		case "stop":
			return { kind: "stop" };
		case "tool_calls":
			return { kind: "tool-calls" };
		case "length":
			return { kind: "max-tokens" };
		default:
			return { kind: "error", failure: { message: `model stopped: ${reason}`, code: String(reason).toUpperCase() } };
	}
}

function mapUsage(usage) {
	const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
	const reasoning = usage.completion_tokens_details?.reasoning_tokens;
	return {
		inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
		outputTokens: usage.completion_tokens,
		...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
		...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
	};
}

// ---- tiny pull-based queue bridging the OkHttp push callback ----

function createAsyncQueue() {
	const items = [];
	let waiter = null;
	let closed = false;
	return {
		push(item) {
			if (closed) return;
			if (waiter) {
				const w = waiter;
				waiter = null;
				w(item);
			} else {
				items.push(item);
			}
		},
		close() {
			closed = true;
			if (waiter) {
				const w = waiter;
				waiter = null;
				w(null);
			}
		},
		async next() {
			if (items.length > 0) return items.shift();
			if (closed) return null;
			return await new Promise((resolve) => {
				waiter = resolve;
			});
		},
	};
}

/** OkHttp streaming POST, mirroring examples/custom_ai_provider's client usage. */
async function okHttpStream(url, headers, bodyJson, onChunk) {
	if (typeof OkHttp === "undefined") throw new LlmError("Operit OkHttp client is not available", "NO_TRANSPORT");
	const client = OkHttp.newBuilder()
		.connectTimeout(30000)
		.readTimeout(120000)
		.writeTimeout(30000)
		.build();
	let request = client.newRequest().url(url).method("POST");
	if (headers && Object.keys(headers).length > 0) request = request.headers(headers);
	request = request.body(bodyJson, "json");
	await request.build().execute({
		onIntermediateResult: (event) => {
			if (event && event.type === "chunk" && event.chunk) onChunk(String(event.chunk));
		},
	});
}

/** Hand-rolled SSE framing over raw chunks. */
async function* parseSseFromChunks(url, headers, body) {
	const queue = createAsyncQueue();
	// The generator body runs on first next(): fire the transport now.
	okHttpStream(url, headers, body, (chunk) => queue.push(chunk)).then(
		() => queue.close(),
		(err) => {
			queue.push({ __error: err });
			queue.close();
		},
	);
	let buffer = "";
	let done = false;
	while (true) {
		const item = await queue.next();
		if (item === null) break;
		if (item && item.__error) throw item.__error;
		buffer += item;
		let sep = buffer.indexOf("\n\n");
		while (sep >= 0) {
			const block = buffer.slice(0, sep);
			buffer = buffer.slice(sep + 2);
			const dataLines = block
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.filter(Boolean);
			if (dataLines.length > 0) {
				for (const payload of dataLines) {
					yield payload;
					if (payload === "[DONE]") done = true;
				}
			}
			sep = buffer.indexOf("\n\n");
		}
	}
	if (!done) throw new LlmError("SSE stream ended without [DONE]", "STREAM_CLOSED");
}

async function* translate(payloads) {
	let nextIndex = 0;
	let textBlock;
	let reasoningBlock;
	const toolBlocks = new Map();
	const order = [];
	let pendingFinish;
	let pendingUsage;
	function open(kind) {
		const block = { index: nextIndex++, kind, text: "" };
		order.push(block);
		return block;
	}
	function closeBlock(block) {
		switch (block.kind) {
			case "text":
				return { type: "text", text: block.text };
			case "reasoning":
				return { type: "reasoning", text: block.text };
			case "tool-call":
				return { type: "tool-call", id: CallId(block.callId ?? ""), name: block.name ?? "", arguments: block.text };
		}
	}
	for await (const payload of payloads) {
		if (payload === "[DONE]") {
			for (const block of order) yield { type: "block-end", index: block.index, block: closeBlock(block) };
			if (pendingUsage) yield { type: "usage", usage: pendingUsage };
			const reason = pendingFinish ?? { kind: "stop" };
			yield {
				type: "finish",
				reason:
					reason.kind === "stop" && order.length === 0
						? { kind: "error", failure: { message: "model returned a completed response with no content", code: "EMPTY_RESPONSE" } }
						: reason,
			};
			return;
		}
		let chunk;
		try {
			chunk = JSON.parse(payload);
		} catch {
			throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
		}
		for (const choice of chunk.choices ?? []) {
			const delta = choice.delta;
			const reasoning = delta?.reasoning_content;
			if (typeof reasoning === "string" && reasoning.length > 0) {
				if (!reasoningBlock) {
					reasoningBlock = open("reasoning");
					yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
				}
				reasoningBlock.text += reasoning;
				yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
			}
			const content = delta?.content;
			if (typeof content === "string" && content.length > 0) {
				if (!textBlock) {
					textBlock = open("text");
					yield { type: "block-start", index: textBlock.index, blockType: "text" };
				}
				textBlock.text += content;
				yield { type: "text-delta", index: textBlock.index, text: content };
			}
			for (const call of delta?.tool_calls ?? []) {
				let block = toolBlocks.get(call.index);
				if (!block) {
					block = open("tool-call");
					toolBlocks.set(call.index, block);
					yield { type: "block-start", index: block.index, blockType: "tool-call" };
				}
				if (call.id !== undefined) block.callId = call.id;
				if (call.function?.name !== undefined) block.name = call.function.name;
				const fragment = call.function?.arguments ?? "";
				block.text += fragment;
				yield {
					type: "tool-call-delta",
					index: block.index,
					id: CallId(block.callId ?? ""),
					...(block.name !== undefined ? { name: block.name } : {}),
					argumentsDelta: fragment,
				};
			}
			if (typeof choice.finish_reason === "string") pendingFinish = mapFinishReason(choice.finish_reason);
		}
		if (chunk.usage) pendingUsage = mapUsage(chunk.usage);
	}
	throw new LlmError("SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}

export class DeepSeekAdapter extends LlmAdapter {
	constructor(config) {
		super();
		this.config = config ?? {};
	}
	providerInfo(provider) {
		return { id: provider, name: "DeepSeek (chat completions)" };
	}
	resolveModel(provider, model) {
		return Promise.resolve({
			provider,
			id: model,
			name: model,
			context: { contextWindow: 131072 },
		});
	}
	async *stream(options) {
		const endpoint = `${String(this.config.apiEndpoint ?? "https://api.deepseek.com").replace(/\/+$/, "")}/chat/completions`;
		const body = serializeRequest(options);
		yield* translate(
			parseSseFromChunks(endpoint, {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.config.apiKey}`,
			}, body),
		);
	}
}
