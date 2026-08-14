#!/usr/bin/env python3
# Deterministic, idempotent cosmetic patches for the vendored
# @openguardrails/dsh-tui bundle (MIT — modification is permitted; the
# license notice lives in THIRD_PARTY_LICENSES.md). Applied by cli-build.sh
# to whichever copy esbuild will bundle (local vendor/ or npm node_modules),
# so CI artifacts match local releases byte-for-byte.
#
# Patch policy (see skills/dsh-core-embedding SKILL.md): presentation and
# input-ergonomics changes ONLY — never semantic/protocol changes. Patches
# may re-route input to an existing interaction path (same outputs), but
# must not alter what the TUI sends back or how it behaves otherwise.
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

CLARIFY_OLD = '''		} else if (matchesKey(data, Key.space) && this.question.multiSelect) {
			if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex);
			else this.selected.add(this.selectedIndex);
		} else if (matchesKey(data, Key.enter)) {'''
CLARIFY_NEW = '''		} else if (matchesKey(data, Key.space) && this.question.multiSelect) {
			if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex);
			else this.selected.add(this.selectedIndex);
		} else if (typeof data === "string" && data.length === 1 && data >= " " && data !== " " && data !== "\\x7f") {
			// dsh-mini patch: typing any printable character switches straight
			// into the custom-answer input (Tab still toggles it manually).
			// Same done() payload as the Tab path — input ergonomics only.
			this.mode = "custom";
			this.selectedBlockPage = {
				offset: 0,
				size: 1,
				maxOffset: 0
			};
			this.error = "";
			this.input.handleInput(data);
		} else if (matchesKey(data, Key.enter)) {'''
CLARIFY_HINT_OLD = '''				"Tab custom answer",'''
CLARIFY_HINT_NEW = '''				"Type or Tab: custom answer",'''
CLARIFY_ERROR_OLD = '''				this.error = "Select at least one option, or press Tab for a custom answer.";'''
CLARIFY_ERROR_NEW = '''				this.error = "Select at least one option, press Tab, or just type your answer.";'''


def apply(path):
	with open(path, encoding="utf-8") as f:
		src = f.read()
	changed = []
	missing = []
	if "dsh-mini patch: bright magenta" not in src:
		if ACCENT_OLD in src:
			src = src.replace(ACCENT_OLD, ACCENT_NEW, 1)
			changed.append("accent-blue")
		else:
			missing.append("accent-blue")
	else:
		changed.append("accent-blue (already)")
	if "dsh-mini patch: cap the standing panel" not in src:
		if TODO_OLD in src and TODO_TAIL_OLD in src:
			src = src.replace(TODO_OLD, TODO_NEW, 1)
			src = src.replace(TODO_TAIL_OLD, TODO_TAIL_NEW, 1)
			changed.append("todo-cap-3")
		else:
			missing.append("todo-cap-3")
	else:
		changed.append("todo-cap-3 (already)")
	if "dsh-mini patch: typing any printable character" not in src:
		if CLARIFY_OLD in src and CLARIFY_HINT_OLD in src and CLARIFY_ERROR_OLD in src:
			src = src.replace(CLARIFY_OLD, CLARIFY_NEW, 1)
			src = src.replace(CLARIFY_HINT_OLD, CLARIFY_HINT_NEW, 1)
			src = src.replace(CLARIFY_ERROR_OLD, CLARIFY_ERROR_NEW, 1)
			changed.append("clarify-type-custom")
		else:
			missing.append("clarify-type-custom")
	else:
		changed.append("clarify-type-custom (already)")
	if changed:
		with open(path, "w", encoding="utf-8") as f:
			f.write(src)
	print(f"patched {path}: {', '.join(changed)}")
	if missing:
		print(f"ERROR anchors missing in {path}: {', '.join(missing)}", file=sys.stderr)
		return False
	return True


if __name__ == "__main__":
	ok = all(apply(p) for p in sys.argv[1:])
	sys.exit(0 if ok else 1)
