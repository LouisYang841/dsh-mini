import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, discover } from "../cli/skill-scanner.js";

test("parseFrontmatter: 解析标量字段（name/description/whenToUse）", () => {
	const { meta, body } = parseFrontmatter(`---
name: my-skill
description: Does things
whenToUse: When needed
---

# Body
content here
`);
	assert.equal(meta.name, "my-skill");
	assert.equal(meta.description, "Does things");
	assert.equal(meta.whenToUse, "When needed");
	assert.ok(body.includes("content here"));
});

test("parseFrontmatter: 无 frontmatter 时原样返回", () => {
	const { meta, body } = parseFrontmatter("just text");
	assert.deepEqual(meta, {});
	assert.equal(body, "just text");
});

test("parseFrontmatter: 引号去除", () => {
	const { meta } = parseFrontmatter("---\nname: \"quoted\"\n---\nbody");
	assert.equal(meta.name, "quoted");
});

test("parseFrontmatter: CRLF 兼容", () => {
	const { meta } = parseFrontmatter("---\r\nname: crlf-skill\r\n---\r\nbody");
	assert.equal(meta.name, "crlf-skill");
});

test("discover: 找到 <name>/SKILL.md 和 <name>.md", () => {
	const root = mkdtempSync(join(tmpdir(), "dsh-skill-test-"));
	mkdirSync(join(root, "dir-skill"));
	writeFileSync(join(root, "dir-skill", "SKILL.md"), "---\nname: dir-skill\n---\nbody");
	writeFileSync(join(root, "file-skill.md"), "---\nname: file-skill\n---\nbody");
	const found = discover([root]);
	const names = found.map((f) => f.name).sort();
	assert.deepEqual(names, ["dir-skill", "file-skill"]);
	rmSync(root, { recursive: true, force: true });
});

test("discover: 不存在的 root 返回空数组", () => {
	assert.deepEqual(discover(["/nonexistent"]), []);
});
