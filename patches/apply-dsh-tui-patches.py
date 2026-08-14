#!/usr/bin/env python3
# Deterministic, idempotent cosmetic patches for the vendored
# @openguardrails/dsh-tui bundle (MIT — modification is permitted; the
# license notice lives in THIRD_PARTY_LICENSES.md). Applied by cli-build.sh
# to whichever copy esbuild will bundle (local vendor/ or npm node_modules),
# so CI artifacts match local releases byte-for-byte.
#
# Patch policy (see skills/dsh-core-embedding SKILL.md): cosmetic,
# config-less presentation changes ONLY — never logic changes.
import sys

ACCENT_OLD = '''			accent: {
				open: "95",
				close: "39",
				purpose: "The one emphasis color: role headers, prompt, borders"
			},'''
ACCENT_NEW = '''			// dsh-mini patch: bright magenta (95) -> DeepSeek blue (34).
			accent: {
				open: "34",
				close: "39",
				purpose: "The one emphasis color: role headers, prompt, borders"
			},'''

TODO_OLD = '''	render(width) {
		if (this.todos.length === 0) return [];
		const lines = [this.palette.bold(this.palette.accent("Plan"))];
		for (const todo of this.todos) {'''
TODO_NEW = '''	render(width) {
		if (this.todos.length === 0) return [];
		// dsh-mini patch: cap the standing panel at the 3 most recent
		// non-completed todos (+ a dim counter).
		const active = this.todos.filter((todo) => todo.status !== "completed");
		const shown = (active.length > 0 ? active : this.todos).slice(-3);
		const hidden = this.todos.length - shown.length;
		const lines = [this.palette.bold(this.palette.accent("Plan"))];
		for (const todo of shown) {'''
TODO_TAIL_OLD = '''			lines.push(truncateToWidth(`  ${prefix} ${text}`, width, ""));
		}
		return ["", ...lines];
	}
};'''
TODO_TAIL_NEW = '''			lines.push(truncateToWidth(`  ${prefix} ${text}`, width, ""));
		}
		if (hidden > 0) lines.push(this.palette.dim(`  … +${hidden} more`));
		return ["", ...lines];
	}
};'''


def apply(path):
	with open(path, encoding="utf-8") as f:
		src = f.read()
	changed = []
	if "dsh-mini patch: bright magenta" not in src:
		if ACCENT_OLD in src:
			src = src.replace(ACCENT_OLD, ACCENT_NEW)
			changed.append("accent-blue")
	else:
		changed.append("accent-blue (already)")
	if "dsh-mini patch: cap the standing panel" not in src:
		if TODO_OLD in src:
			src = src.replace(TODO_OLD, TODO_NEW)
			src = src.replace(TODO_TAIL_OLD, TODO_TAIL_NEW)
			changed.append("todo-cap-3")
	else:
		changed.append("todo-cap-3 (already)")
	if changed:
		with open(path, "w", encoding="utf-8") as f:
			f.write(src)
	print(f"patched {path}: {', '.join(changed)}")


if __name__ == "__main__":
	for p in sys.argv[1:]:
		apply(p)
