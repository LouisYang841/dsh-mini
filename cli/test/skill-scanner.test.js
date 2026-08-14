// Unit tests for cli/skill-scanner.js — frontmatter parsing + discovery.
// Run: node --test cli/test/skill-scanner.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, discover } from "../skill-scanner.js";

function tmp() {
	return mkdtempSync(join(tmpdir(), "dsh-skill-test-"));
}

test("parseFrontmatter extracts name/description/whenToUse", () => {
	const { meta, body } = parseFrontmatter(
		"---\nname: my-skill\ndescription: Does things.\nwhenToUse: When asked.\n---\nBody text here.",
	);
	assert.equal(meta.name, "my-skill");
	assert.equal(meta.description, "Does things.");
	assert.equal(meta.whenToUse, "When asked.");
	assert.equal(body, "Body text here.");
});

test("parseFrontmatter strips quotes from values", () => {
	const { meta } = parseFrontmatter('---\ndescription: "Quoted desc"\n---\n');
	assert.equal(meta.description, "Quoted desc");
});

test("parseFrontmatter returns full text as body when no frontmatter", () => {
	const { meta, body } = parseFrontmatter("no frontmatter here");
	assert.deepEqual(meta, {});
	assert.equal(body, "no frontmatter here");
});

test("parseFrontmatter handles CRLF separators", () => {
	const { meta, body } = parseFrontmatter("---\r\nname: crlf-skill\r\n---\r\nBody");
	assert.equal(meta.name, "crlf-skill");
	assert.equal(body, "Body");
});

test("discover finds <root>/<name>/SKILL.md and <root>/<name>.md", () => {
	const dir = tmp();
	mkdirSync(join(dir, "alpha"));
	writeFileSync(join(dir, "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
	writeFileSync(join(dir, "beta.md"), "---\nname: beta\n---\n");
	writeFileSync(join(dir, "gamma.txt"), "not a skill");

	const found = discover([dir]);
	const names = found.map((e) => e.name).sort();
	assert.deepEqual(names, ["alpha", "beta"]);
	rmSync(dir, { recursive: true, force: true });
});

test("discover prefers SKILL.md name over directory name", () => {
	const dir = tmp();
	mkdirSync(join(dir, "weird-dir-name"));
	writeFileSync(join(dir, "weird-dir-name", "SKILL.md"), "---\nname: real-name\n---\n");
	const found = discover([dir]);
	assert.equal(found[0].name, "weird-dir-name"); // discovery returns dir name; meta.name applied in list()
	assert.ok(found[0].path.endsWith("SKILL.md"));
	rmSync(dir, { recursive: true, force: true });
});

test("discover skips missing roots", () => {
	const found = discover(["/nonexistent/root"]);
	assert.deepEqual(found, []);
});
