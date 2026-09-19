import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Parse } from "typebox/value";

const configSchema = Type.Partial(
	Type.Object({
		enabled: Type.Boolean(),
		model: Type.String({ minLength: 1 }),
		baseUrl: Type.String({ minLength: 1 }),
		keepThreshold: Type.Number({ minimum: 0, maximum: 1 }),
		preserveRecentMessages: Type.Integer({ minimum: 0 }),
		maxStateTokens: Type.Number({ exclusiveMinimum: 0 }),
		maxRequestTokens: Type.Number({ exclusiveMinimum: 0 }),
		truncateHeadChars: Type.Integer({ minimum: 0 }),
		minReductionRatio: Type.Number({ minimum: 0, maximum: 1 }),
		notify: Type.Boolean(),
	}),
);

export interface Config {
	enabled: boolean;
	model: string;
	baseUrl?: string;
	keepThreshold: number;
	preserveRecentMessages: number;
	maxStateTokens: number;
	maxRequestTokens: number;
	truncateHeadChars: number;
	minReductionRatio: number;
	notify: boolean;
}

export interface LoadedConfig {
	config: Config;
	error?: string;
}

export const configPath = join(homedir(), ".pi", "agent", "extensions", "fast-jev-compaction", "config.json");

export const defaultConfig: Config = {
	enabled: true,
	model: "jev-latest",
	keepThreshold: 0.5,
	preserveRecentMessages: 0,
	maxStateTokens: 25_000,
	maxRequestTokens: 30_000,
	truncateHeadChars: 300,
	minReductionRatio: 0.25,
	notify: true,
};

export function loadConfig(path = configPath): LoadedConfig {
	if (!existsSync(path)) return { config: defaultConfig };
	try {
		const input = Parse(configSchema, JSON.parse(readFileSync(path, "utf8")));
		return { config: { ...defaultConfig, ...input } };
	} catch (error) {
		return { config: defaultConfig, error: error instanceof Error ? error.message : String(error) };
	}
}
