// Durable session log for Operit: append-only JSONL (NO zstd) stored via
// Operit's file tools (write_file / read_file_full / file_exists from
// StandardFileSystemTools). The engine itself is untouched; this is the
// host-side persistence seam — the CLI equivalent uses dsh-session-
// persistence-jsonl with zstd, which needs node:fs and cannot run inside
// Operit's QuickJS.
//
// Scope tonight: events survive app restarts as data. Full resume
// continuity (rebuilding a live agent from the log) needs the
// SessionPersistence service contract, documented in README as next work.

const DEFAULT_SESSION_PATH = "dshmini/sessions/main.jsonl";
const MAX_KEPT_EVENTS = 4000;

export function sessionLogPath() {
	const configured = typeof globalThis.__DSH_SESSION_PATH === "string"
		? globalThis.__DSH_SESSION_PATH
		: DEFAULT_SESSION_PATH;
	return configured;
}

async function fileExists(path) {
	try {
		const result = await toolCall({ name: "file_exists", params: { path } });
		const parsed = typeof result === "string" ? JSON.parse(result) : result;
		if (parsed && typeof parsed === "object") {
			if (parsed.success === false) return false;
			if (Object.prototype.hasOwnProperty.call(parsed, "exists")) return parsed.exists === true || parsed.exists === "true";
		}
		return false;
	} catch {
		return false;
	}
}

async function readText(path) {
	const result = await toolCall({ name: "read_file_full", params: { path } });
	if (result && typeof result === "object" && result.success === false) {
		throw new Error(result.error || result.message || "read_file_full failed");
	}
	if (typeof result === "string") return result;
	for (const key of ["content", "result", "data", "text"]) {
		const value = result?.[key];
		if (typeof value === "string") return value;
	}
	return JSON.stringify(result ?? "");
}

async function writeText(path, content) {
	const result = await toolCall({ name: "write_file", params: { path, content } });
	if (result && typeof result === "object" && result.success === false) {
		throw new Error(result.error || result.message || "write_file failed");
	}
}

function serializeEvent(event) {
	try {
		return JSON.stringify(event);
	} catch {
		return JSON.stringify({ type: "unserializable", at: Date.now() });
	}
}

/** Append one turn's new events to the JSONL log (read-modify-write, capped). */
export async function appendSessionEvents(engine) {
	const path = sessionLogPath();
	let existing = "";
	try {
		if (await fileExists(path)) existing = await readText(path);
	} catch {
		existing = ""; // first write or unreadable log: start fresh
	}
	const events = engine.agent.session.events;
	const lines = existing.split("\n").filter((line) => line.trim().length > 0);
	// `session.events` is the cumulative log, not a per-turn delta. Append only
	// events after the persisted prefix so each event is written once.
	const newEvents = lines.length <= events.length ? events.slice(lines.length) : [];
	lines.push(...newEvents.map(serializeEvent));
	while (lines.length > MAX_KEPT_EVENTS) lines.shift();
	await writeText(path, lines.join("\n") + "\n");
	return { path, events: lines.length, appended: newEvents.length };
}

/** Read the persisted log (for diagnostics and future resume). */
export async function loadSessionEvents() {
	const path = sessionLogPath();
	if (!(await fileExists(path))) return [];
	const text = await readText(path);
	const events = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {
			// torn tail: stop at the first unparseable line
			break;
		}
	}
	return events;
}
