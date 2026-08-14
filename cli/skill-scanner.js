// Minimal filesystem skill provider for the DSH skill registry (seam: the
// official dsh-skill-filesystem scanner drags chokidar + yaml — rejected as a
// big head). Discovers <root>/<name>/SKILL.md and <root>/<name>.md, parses
// frontmatter scalars (name/description/whenToUse), and loads bodies on
// demand through the registry's provider contract.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseFrontmatter(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: text };
	const meta = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
	}
	return { meta, body: match[2] };
}

export function discover(roots) {
	const found = new Map();
	for (const root of roots) {
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			let mdPath = null;
			let name = null;
			if (entry.isDirectory()) {
				const candidate = join(root, entry.name, "SKILL.md");
				if (existsSync(candidate)) {
					mdPath = candidate;
					name = entry.name;
				}
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				mdPath = join(root, entry.name);
				name = entry.name.replace(/\.md$/, "");
			}
			if (mdPath && !found.has(name)) found.set(name, mdPath);
		}
	}
	return [...found.entries()].map(([name, path]) => ({ name, path }));
}

export function defineFilesystemSkillProvider(roots) {
	const discovered = discover(roots);
	return {
		name: "filesystem",
		async list() {
			return discovered.map((entry, index) => {
				const { meta } = parseFrontmatter(readFileSync(entry.path, "utf8"));
				const skillName = typeof meta.name === "string" && KEBAB_RE.test(meta.name) ? meta.name : entry.name;
				return {
					name: skillName,
					description: typeof meta.description === "string" ? meta.description : "",
					...(typeof meta.whenToUse === "string" ? { whenToUse: meta.whenToUse } : {}),
					invocation: {
						modelInvocable: meta.disable_model_invocation !== true && meta["disable-model-invocation"] !== true,
						userInvocable: meta.user_invocable !== false,
					},
					source: entry.path.includes("/.dsh-mini/") ? "user-dsh" : "project-dsh",
					provider: "filesystem",
					rank: index,
					locator: entry.path,
					path: entry.path,
				};
			});
		},
		async get(candidate) {
			const { meta, body } = parseFrontmatter(readFileSync(candidate.locator, "utf8"));
			return {
				...candidate,
				content: body,
				metadata: meta,
			};
		},
	};
}
