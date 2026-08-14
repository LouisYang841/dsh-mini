// Node-side fakes of Operit's JS-runtime globals. Lets operit/dist/main.js
// (built for Operit's QuickJS) run under Node for verification:
//   - ToolPkg.registerAiProvider records the provider definition
//   - OkHttp mirrors the example client API over node fetch + streams
//   - toolCall implements the same tool names as operit/src/tools.js
//   - sendIntermediateResult collects relayed chunks

import { exec as nodeExec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative, isAbsolute, sep } from "node:path";
const execAsync = promisify(nodeExec);

// File-tool backing store for the session log mock.
const MOCK_ROOT = join(new URL(".", import.meta.url).pathname, ".mock-store");
export function mockResolvePath(path) {
	const target = join(MOCK_ROOT, path.replace(/^\/+/, ""));
	const rel = relative(MOCK_ROOT, target);
	if (isAbsolute(target) && rel !== "" && (rel === ".." || rel.startsWith(`..${sep}`))) {
		throw new Error(`mock file path escapes MOCK_ROOT: ${path}`);
	}
	return target;
}

export const relayedChunks = [];

globalThis.ToolPkg = {
	registerAiProvider(config) {
		globalThis.__dshProvider = config;
	},
	ActivePromptSnapshot: {},
};

globalThis.sendIntermediateResult = (payload) => {
	if (payload?.chunk) {
		relayedChunks.push(payload.chunk);
		process.stdout.write(payload.chunk);
	}
};

class MockRequest {
	constructor(client) {
		this.client = client;
		this._url = "";
		this._method = "GET";
		this._headers = {};
		this._body = null;
		this._bodyType = "text";
	}
	url(u) {
		this._url = u;
		return this;
	}
	method(m) {
		this._method = m;
		return this;
	}
	headers(h) {
		this._headers = { ...this._headers, ...h };
		return this;
	}
	body(b, type) {
		this._body = b;
		this._bodyType = type || "text";
		return this;
	}
	build() {
		return this;
	}
	async execute(options) {
		const body = this._bodyType === "json" ? JSON.stringify(this._body) : String(this._body ?? "");
		const response = await fetch(this._url, { method: this._method, headers: this._headers, body });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			options?.onIntermediateResult?.({ type: "chunk", chunk: decoder.decode(value, { stream: true }) });
		}
		return { isSuccessful: () => true, statusCode: response.status };
	}
}

class MockOkHttp {
	static newBuilder() {
		return new MockOkHttp();
	}
	connectTimeout() {
		return this;
	}
	readTimeout() {
		return this;
	}
	writeTimeout() {
		return this;
	}
	build() {
		return this;
	}
	newRequest() {
		return new MockRequest(this);
	}
}

globalThis.OkHttp = MockOkHttp;

globalThis.toolCall = async ({ name, params }) => {
	if (name === "terminal") {
		const command = params?.command ?? "";
		const timeoutMs = Math.max(3000, Number(params?.timeoutMs ?? 15000));
		try {
			const { stdout, stderr } = await execAsync(command, { timeout: Math.min(timeoutMs, 300000), maxBuffer: 10 * 1024 * 1024 });
			const output = `${stdout}${stderr}`;
			return { success: true, result: output || "(no output)" };
		} catch (error) {
			const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? error}`;
			return { success: error.code === 0, result: output || "(no output)" };
		}
	}
	if (name === "file_exists") {
		return { success: true, result: String(existsSync(mockResolvePath(params?.path ?? ""))) };
	}
	if (name === "read_file_full") {
		const target = mockResolvePath(params?.path ?? "");
		if (!existsSync(target)) return { success: false, error: "not found" };
		return { success: true, content: readFileSync(target, "utf8") };
	}
	if (name === "write_file") {
		const target = mockResolvePath(params?.path ?? "");
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, String(params?.content ?? ""), "utf8");
		return { success: true, result: "written" };
	}
	return { success: false, error: `mock toolCall: unknown tool "${name}"` };
};

// The build targets Operit's QuickJS, which has neither TextDecoder nor
// fetch-free Web Streams — but the mock transport runs on Node where both
// exist globally. Nothing to add.
