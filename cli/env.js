// Env loading + credential persistence — pure-ish functions extracted from
// cli.js for testability. File-system side effects are confined to the
// explicit read/write calls below; no DSH tree imports.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Load KEY=VALUE lines from a list of env files into `targetEnv`,
 * never overriding keys that are already set. Same semantics as the
 * inline loop that used to live in cli.js.
 * @param {string[]} envFiles absolute paths, in priority order
 * @param {Record<string,string>} targetEnv the env object to mutate (default process.env)
 */
export function loadEnvFiles(envFiles, targetEnv = process.env) {
	for (const envFile of envFiles) {
		try {
			if (!existsSync(envFile)) continue;
			for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
				const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
				if (match && targetEnv[match[1]] === undefined) targetEnv[match[1]] = match[2].trim();
			}
		} catch {
			// unreadable env file is not fatal
		}
	}
}

/**
 * Persist a credential key to the first writable target file, in order.
 * Returns the path written, or null if every target failed.
 * @param {string[]} targets candidate absolute file paths, in priority order
 * @param {string} key the KEY (e.g. DEEPSEEK_API_KEY)
 * @param {string} value the VALUE to write
 */
export function persistCredential(targets, key, value) {
	for (const target of targets) {
		try {
			mkdirSync(dirname(target), { recursive: true });
			const previous = existsSync(target)
				? readFileSync(target, "utf8").replace(new RegExp(`^${key}=.*$`, "m"), "").trimEnd()
				: "";
			writeFileSync(target, `${previous}${previous ? "\n" : ""}${key}=${value}\n`);
			return target;
		} catch {
			// try the next target
		}
	}
	return null;
}
