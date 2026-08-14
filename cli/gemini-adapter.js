// Gemini adapter for the DSH llm seam (Google AI Studio, SSE streaming).
// Implements the LlmAdapter contract: adapter.stream(options) yields
// BlockAssembler chunks (block-start/text-delta/tool-call-delta/block-end/
// usage/finish) converted from the Gemini streamGenerateContent SSE stream.
import { CallId, LlmAdapter, attributionHeaders } from "@deepseek-ai/dsh-llm";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiAdapter extends LlmAdapter {
	constructor(apiKey, baseUrl = DEFAULT_BASE) {
		super();
		this.apiKey = apiKey;
		this.baseUrl = baseUrl;
		// Gemini 3 requires model thought_signature values echoed back on
		// functionCall parts in follow-up turns. DSH messages do not carry
		// them, so the adapter remembers them per call id (in-memory).
		this.signatures = new Map();
	}
	providerInfo(provider) {
		return { id: provider, name: "Google Gemini (AI Studio)" };
	}
	resolveModel(provider, model) {
		return Promise.resolve({
			provider,
			id: model,
			name: model,
			context: { contextWindow: 1048576 },
		});
	}
	stream(options) {
		return this.generateStream(options);
	}

	// ---- Gemini wire conversion ----

	buildContents(messages) {
		const contents = [];
		const callNames = new Map(); // toolCallId -> name (for functionResponse lookup)
		const pushParts = (role, parts) => {
			// Gemini requires strictly alternating user/model turns: merge
			// consecutive same-role entries into one turn.
			const last = contents[contents.length - 1];
			if (last && last.role === role) {
				last.parts.push(...parts);
			} else {
				contents.push({ role, parts });
			}
		};
		for (const message of messages) {
			if (message.role === "user") {
				const parts = [];
				for (const block of message.content) {
					if (block.type === "text") parts.push({ text: block.text });
					else if (block.type === "tool-result") {
						const name = callNames.get(block.toolCallId) ?? message.source?.callId ?? "unknown";
						parts.push({
							functionResponse: {
								name,
								response: { content: block.content, isError: !!block.isError },
							},
						});
					} else if (block.type === "image") {
						parts.push({
							inlineData: {
								mimeType: block.mimeType ?? "image/png",
								data: block.base64 ?? "",
							},
						});
					}
				}
				if (parts.length > 0) pushParts("user", parts);
			} else if (message.role === "assistant") {
				const parts = [];
				for (const block of message.content) {
					if (block.type === "text" && block.text) parts.push({ text: block.text });
					else if (block.type === "reasoning" && block.text) parts.push({ text: block.text });
					else if (block.type === "tool-call") {
						callNames.set(block.id, block.name);
						let args = {};
						try {
							args = block.arguments ? JSON.parse(block.arguments) : {};
						} catch {
							args = { raw: block.arguments };
						}
						const signature = this.signatures.get(block.id);
						if (signature) {
							// The REST request shape mirrors the response: the
							// signature is a part-level sibling of functionCall.
							parts.push({ functionCall: { name: block.name, args }, thoughtSignature: signature });
						} else {
							parts.push({ functionCall: { name: block.name, args } });
						}
					}
				}
				if (parts.length > 0) pushParts("model", parts);
			}
		}
		return contents;
	}

	buildBody(options) {
		const contents = this.buildContents(options.messages);
		const body = {
			contents,
			tools: (options.tools ?? []).length
				? [{ functionDeclarations: options.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters ?? {} })) }]
				: undefined,
			generationConfig: options.maxTokens ? { maxOutputTokens: options.maxTokens } : undefined,
		};
		if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
		// drop undefined keys
		for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
		return body;
	}

	async *generateStream(options) {
		const url = `${this.baseUrl}/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`;
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const wireBody = this.buildBody(options);
		if (process.env.GEMINI_DEBUG) console.error("[gemini] tools:", JSON.stringify(wireBody.tools ?? null), "\n[gemini] system:", JSON.stringify(wireBody.systemInstruction ?? null).slice(0, 300));
		const body = JSON.stringify(wireBody);
		let response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-goog-api-key": this.apiKey,
					...attributionHeaders(),
				},
				body,
				signal: controller.signal,
			});
		} catch (error) {
			options.signal?.removeEventListener("abort", onAbort);
			if (options.signal?.aborted) {
				const failure = { message: "aborted", code: "ABORTED" };
				yield { type: "finish", reason: { kind: "aborted", failure } };
				return;
			}
			const failure = { message: error instanceof Error ? error.message : String(error), code: "FETCH_ERROR" };
			yield { type: "finish", reason: { kind: "error", failure } };
			return;
		}
		if (!response.ok) {
			options.signal?.removeEventListener("abort", onAbort);
			const text = await response.text().catch(() => "");
			const failure = { message: `Gemini HTTP ${response.status}: ${text.slice(0, 500)}`, code: "GEMINI_HTTP_ERROR" };
			yield { type: "finish", reason: { kind: "error", failure } };
			return;
		}

		let textBlockStarted = false;
		let fullText = "";
		let toolIndex = 0;
		let usage = undefined;
		let finishReason = undefined;
		let anyCandidate = false;
		let lastCallId = undefined;

		try {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newlineIndex;
				while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);
					if (!line.startsWith("data:")) continue;
					const payload = line.slice(5).trim();
					if (!payload) continue;
					let event;
					try {
						event = JSON.parse(payload);
					} catch {
						continue;
					}
					if (event.usageMetadata) {
						usage = {
							inputTokens: event.usageMetadata.promptTokenCount ?? 0,
							outputTokens: event.usageMetadata.candidatesTokenCount ?? 0,
							cachedInputTokens: event.usageMetadata.cachedContentTokenCount ?? 0,
						};
					}
					const candidate = event.candidates?.[0];
					if (!candidate) continue;
					anyCandidate = true;
					if (candidate.finishReason) finishReason = candidate.finishReason;
					for (const part of candidate.content?.parts ?? []) {
						if (process.env.GEMINI_DEBUG) console.error("[gemini] part:", JSON.stringify(part).slice(0, 300));
						if (typeof part.text === "string") {
							if (!textBlockStarted) {
								yield { type: "block-start", index: 0, blockType: "text" };
								textBlockStarted = true;
							}
							fullText += part.text;
							yield { type: "text-delta", index: 0, text: part.text };
						} else if (part.functionCall) {
							toolIndex += 1;
							lastCallId = CallId(`gemini-call-${toolIndex}`);
							if (process.env.GEMINI_DEBUG) console.error("[gemini] functionCall part:", JSON.stringify(part.functionCall).slice(0, 400));
							if (part.thoughtSignature) this.signatures.set(lastCallId, part.thoughtSignature);
							yield { type: "block-start", index: toolIndex, blockType: "tool-call" };
							yield {
								type: "tool-call-delta",
								index: toolIndex,
								id: lastCallId,
								name: part.functionCall.name,
								argumentsDelta: JSON.stringify(part.functionCall.args ?? {}),
							};
							yield {
								type: "block-end",
								index: toolIndex,
								block: {
									type: "tool-call",
									id: lastCallId,
									name: part.functionCall.name,
									arguments: JSON.stringify(part.functionCall.args ?? {}),
								},
							};
						}
					}
				}
			}
		} catch (error) {
			options.signal?.removeEventListener("abort", onAbort);
			if (options.signal?.aborted) {
				const failure = { message: "aborted", code: "ABORTED" };
				yield { type: "finish", reason: { kind: "aborted", failure } };
				return;
			}
			const failure = { message: error instanceof Error ? error.message : String(error), code: "STREAM_ERROR" };
			yield { type: "finish", reason: { kind: "error", failure } };
			return;
		} finally {
			options.signal?.removeEventListener("abort", onAbort);
		}

		if (textBlockStarted) {
			yield { type: "block-end", index: 0, block: { type: "text", text: fullText } };
		}
		if (usage) yield { type: "usage", usage };
		if (!anyCandidate) {
			const failure = { message: "Gemini returned no candidates (blocked or empty response)", code: "GEMINI_EMPTY" };
			yield { type: "finish", reason: { kind: "error", failure } };
			return;
		}
		if (finishReason === "MAX_TOKENS") {
			yield { type: "finish", reason: { kind: "max-tokens" } };
		} else if (finishReason === "STOP" || finishReason === undefined) {
			yield { type: "finish", reason: { kind: "stop" } };
		} else {
			const failure = { message: `Gemini finish reason: ${finishReason}`, code: `GEMINI_${finishReason}` };
			yield { type: "finish", reason: { kind: "error", failure } };
		}
	}
}
export default GeminiAdapter;
