// Minimal filesystem skill provider for the DSH skill registry (seam: the
// official dsh-skill-filesystem scanner drags chokidar + yaml — rejected as a
// big head). Discovers <root>/<name>/SKILL.md and <root>/<name>.md, parses
// frontmatter scalars (name/description/whenToUse), and loads bodies on
// demand through the registry's provider contract.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseScalar(value) {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return value;
}

function parseFrontmatter(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: text };
	const meta = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (kv) meta[kv[1]] = parseScalar(kv[2].trim().replace(/^["']|["']$/g, ""));
	}
	return { meta, body: match[2] };
}

function discover(roots) {
	const found = new Map();
	for (const root of roots) {
		let entries;
		try {
			if (!existsSync(root)) continue;
			entries = readdirSync(root, { withFileTypes: true });
		} catch {
			// An unreadable root must not remove skills from the other root.
			continue;
		}
		for (const entry of entries) {
			let mdPath = null;
			let name = null;
			if (entry.isDirectory()) {
				const candidate = join(root, entry.name, "SKILL.md");
				try {
					if (existsSync(candidate)) {
						mdPath = candidate;
						name = entry.name;
					}
				} catch {
					// Permission denied or a racing delete: skip this candidate.
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
			const listed = [];
			let index = 0;
			for (const entry of discovered) {
				let meta;
				try {
					meta = parseFrontmatter(readFileSync(entry.path, "utf8")).meta;
				} catch {
					// The file may have been deleted/renamed since discovery.
					continue;
				}
				const skillName = typeof meta.name === "string" && KEBAB_RE.test(meta.name) ? meta.name : entry.name;
				const disabledModel = meta.disable_model_invocation === true || meta["disable-model-invocation"] === true;
				listed.push({
					name: skillName,
					description: typeof meta.description === "string" ? meta.description : "",
					...(typeof meta.whenToUse === "string" ? { whenToUse: meta.whenToUse } : {}),
					invocation: {
						modelInvocable: !disabledModel,
						userInvocable: meta.user_invocable !== false,
					},
					source: entry.path.includes("/.dsh-mini/") ? "user-dsh" : "project-dsh",
					provider: "filesystem",
					rank: index,
					locator: entry.path,
					path: entry.path,
				});
				index += 1;
			}
			return listed;
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
