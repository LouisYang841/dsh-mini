// Env-file loading + credential persistence, extracted from cli.js for
// testability. Behavior is IDENTICAL to the original inline logic.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// KEY=VALUE lines from env files; never overriding the real environment.
// Unreadable env files are not fatal.
export function loadEnvFiles(paths, env) {
	for (const envFile of paths) {
		try {
			if (!existsSync(envFile)) continue;
			for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
				const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
				if (match && env[match[1]] === undefined) env[match[1]] = match[2].trim();
			}
		} catch {
			// unreadable env file is not fatal
		}
	}
}

// Persist an interactively entered key: try targets in order (user config dir
// first, cwd .env fallback — both gitignored). Replaces any previous value of
// the same var (idempotent). Returns the target path on success, null if all
// targets failed.
export function persistCredential(targets, env, envName, key) {
	for (const target of targets) {
		try {
			mkdirSync(dirname(target), { recursive: true });
			const previous = existsSync(target)
				? readFileSync(target, "utf8").replace(new RegExp(`^${envName}=.*$`, "m"), "").trimEnd()
				: "";
			writeFileSync(target, `${previous}${previous ? "\n" : ""}${envName}=${key}\n`);
			return target;
		} catch {
			// try the next target
		}
	}
	return null;
}
