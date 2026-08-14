// Derived from @earendil-works/pi coding-agent
// (packages/coding-agent/src/core/bash-executor.ts, MIT). Import paths were
// adapted; dsh-mini adds BashOperations, timeout/env forwarding, and spill-file
// completion handling around the upstream execution loop.
/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "./ansi.ts";
import { sanitizeBinaryOutput } from "./shell.ts";
/**
 * Shell execution backend contract (from @earendil-works/pi coding-agent
 * tools/bash.ts). Override to delegate to remote systems (SSH, containers).
 */
export interface BashOperations {
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: Record<string, string | undefined>;
		},
	) => Promise<{ exitCode: number | null }>;
}
import { DEFAULT_MAX_BYTES, truncateTail } from "./truncate.ts";

// ============================================================================
// Types
// ============================================================================

export interface BashExecutorOptions {
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Optional command timeout forwarded to BashOperations.exec */
	timeout?: number;
	/** Optional child environment forwarded to BashOperations.exec */
	env?: Record<string, string | undefined>;
}

export interface BashResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Process exit code (null if killed/cancelled) */
	exitCode: number | null;
	/** Whether the command was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Path to temp file containing full output (if output exceeded truncation threshold) */
	fullOutputPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a bash command using custom BashOperations.
 * Used for remote execution (SSH, containers, etc.).
 */
export async function executeBashWithOperations(
	command: string,
	cwd: string,
	operations: BashOperations,
	options?: BashExecutorOptions,
): Promise<BashResult> {
	const outputChunks: string[] = [];
	let outputBytes = 0;
	const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

	let tempFilePath: string | undefined;
	let tempFileStream: WriteStream | undefined;
	let spillFailed = false;
	let totalBytes = 0;

	const ensureTempFile = () => {
		if (tempFilePath) {
			return;
		}
		const id = randomBytes(8).toString("hex");
		tempFilePath = join(tmpdir(), `pi-bash-${id}.log`);
		const stream = createWriteStream(tempFilePath);
		tempFileStream = stream;
		// Attach the error listener at creation time. A write-stream error
		// before finishTempFile() would otherwise be an uncaught exception.
		stream.once("error", () => {
			spillFailed = true;
			tempFileStream = undefined;
			tempFilePath = undefined;
		});
		for (const chunk of outputChunks) {
			stream.write(chunk);
		}
	};

	const decoder = new TextDecoder();

	const appendText = (text: string) => {
		// Start writing to temp file if exceeds threshold
		if (totalBytes > DEFAULT_MAX_BYTES) {
			ensureTempFile();
		}

		if (tempFileStream) {
			tempFileStream.write(text);
		}

		// Keep rolling buffer
		outputChunks.push(text);
		outputBytes += text.length;
		while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
			const removed = outputChunks.shift()!;
			outputBytes -= removed.length;
		}

		// Stream to callback
		if (options?.onChunk) {
			options.onChunk(text);
		}
	};

	const onData = (data: Buffer) => {
		totalBytes += data.length;

		// Sanitize: strip ANSI, replace binary garbage, normalize newlines
		const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");
		appendText(text);
	};

	// WriteStream.end() only STARTS finalization. Await finish/close before
	// returning a spill path, and omit the path if the spill failed so callers
	// never read a truncated file as the complete output.
	const finishTempFile = () => {
		if (!tempFileStream) return Promise.resolve(!spillFailed);
		const stream = tempFileStream;
		tempFileStream = undefined;
		return new Promise<boolean>((resolve) => {
			stream.once("finish", () => resolve(true));
			stream.once("close", () => resolve(!spillFailed));
			stream.once("error", () => resolve(false));
			stream.end();
		});
	};

	const buildResult = async (exitCode: number | null | undefined, cancelled: boolean) => {
		const tail = decoder.decode();
		if (tail.length > 0) appendText(sanitizeBinaryOutput(stripAnsi(tail)).replace(/\r/g, ""));
		const fullOutput = outputChunks.join("");
		const truncationResult = truncateTail(fullOutput);
		if (truncationResult.truncated) {
			ensureTempFile();
		}
		const spillOk = await finishTempFile();
		return {
			output: truncationResult.truncated ? truncationResult.content : fullOutput,
			exitCode: cancelled ? null : exitCode ?? null,
			cancelled,
			truncated: truncationResult.truncated,
			...(spillOk && tempFilePath !== undefined ? { fullOutputPath: tempFilePath } : {}),
		};
	};

	try {
		const result = await operations.exec(command, cwd, {
			onData,
			signal: options?.signal,
			timeout: options?.timeout,
			env: options?.env,
		});

		return await buildResult(result.exitCode, options?.signal?.aborted ?? false);
	} catch (err) {
		// Check if it was an abort
		if (options?.signal?.aborted) {
			return await buildResult(undefined, true);
		}

		await finishTempFile();
		throw err;
	}
}
