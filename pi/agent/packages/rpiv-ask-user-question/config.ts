/**
 * Local fork note
 * ---------------
 * The `@juicesharp/rpiv-config` helpers used here are vendored inline so this
 * package is self-contained as a pinned local-path pi package (pi does not run
 * `npm install` for local paths, so the external dependency would otherwise be
 * unresolved at runtime).
 *
 * Only the helpers this extension needs are vendored — `configPath`,
 * `loadJsonConfig`, `validateGuidanceFields` (+ the `GuidanceFields` type).
 * Logic is byte-for-byte from rpiv-config@1.19.0. The public API of this module
 * (`loadConfig`, `validateGuidanceFields`) is unchanged from upstream.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── vendored from @juicesharp/rpiv-config ──────────────────────────────────

/** Resolve a config file path under `~/.config/<name>/`. */
function configPath(name: string, file = "config.json"): string {
	return join(homedir(), ".config", name, file);
}

/**
 * Load and parse a JSON config file. Returns `{}` for missing files,
 * malformed JSON, or non-plain-object values.
 */
function loadJsonConfig<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch (err) {
		console.warn(`rpiv-config: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
		return {} as T;
	}
}

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

/** Validate and extract guidance fields from an unknown value. */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	return result;
}

// ── package config surface (unchanged from upstream) ───────────────────────

const CONFIG_PATH = configPath("rpiv-ask-user-question");

interface AskUserQuestionConfig {
	guidance?: GuidanceFields;
}

export function loadConfig(): AskUserQuestionConfig {
	return loadJsonConfig<AskUserQuestionConfig>(CONFIG_PATH);
}
