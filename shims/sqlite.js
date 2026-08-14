// node:sqlite shim — loud failure stubs.
// The session QUERY layer (dsh-session-query-sqlite) is excluded from the
// core bundle; JSONL persistence + in-memory index covers the spike.
function unavailable() {
	throw new Error("node:sqlite is not available in the spike shim");
}
export const DatabaseSync = unavailable;
export default { DatabaseSync };
