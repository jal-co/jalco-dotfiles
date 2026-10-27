import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBoolean, isPlainObject } from "./type-guards.ts";

export interface RoleConfig {
	/** Accepted no-op settings, each with actionable migration text. */
	deprecations: string[];
}

function invalidRoleConfig(source: string, message: string): never {
	throw new Error(`Invalid subagent role config in ${source}: ${message}`);
}

export function parseRoleConfig(
	rawConfig: any,
	source = "config.json",
): RoleConfig {
	if (!isPlainObject(rawConfig)) {
		invalidRoleConfig(source, "root must be an object");
	}
	if (!Object.hasOwn(rawConfig, "roles")) return { deprecations: [] };
	if (!isPlainObject(rawConfig.roles)) {
		invalidRoleConfig(source, "roles must be an object");
	}

	const unsupportedKeys = Object.keys(rawConfig.roles).filter(
		(key) => key !== "bundled",
	);
	if (unsupportedKeys.length > 0) {
		invalidRoleConfig(
			source,
			`roles has unsupported key(s): ${unsupportedKeys.join(", ")}`,
		);
	}
	if (!Object.hasOwn(rawConfig.roles, "bundled")) return { deprecations: [] };
	if (!isBoolean(rawConfig.roles.bundled)) {
		invalidRoleConfig(source, "roles.bundled must be a boolean");
	}
	// The host ships no roles, so both legacy booleans are no-ops. Never rewrite
	// user configuration to remove the key.
	return {
		deprecations: [
			`Deprecated setting roles.bundled (${rawConfig.roles.bundled}) in ${source} is ignored: pi-herdr-agents no longer ships bundled roles. Install a role pack or add global or project definitions for the roles you use, then remove roles.bundled. The file was not changed.`,
		],
	};
}

interface RoleConfigSource {
	sourcePath: string;
	rawConfig: string;
}

function readRoleConfigFile(
	configPath: string,
	examplePath: string,
): RoleConfigSource {
	try {
		return {
			sourcePath: configPath,
			rawConfig: readFileSync(configPath, "utf8"),
		};
	} catch (error) {
		// SAFETY: readFileSync only throws Node fs errors here, which carry code.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code !== "ENOENT") throw error;
	}

	try {
		return {
			sourcePath: examplePath,
			rawConfig: readFileSync(examplePath, "utf8"),
		};
	} catch (error) {
		// SAFETY: see the preceding readFileSync error handling.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code === "ENOENT") {
			throw new Error(
				`Missing subagent role config. Expected ${configPath} or ${examplePath}.`,
			);
		}
		throw error;
	}
}

export function loadRoleConfig(
	configDir: string,
	examplePath: string,
): RoleConfig {
	const configPath = join(configDir, "config.json");
	const { sourcePath, rawConfig } = readRoleConfigFile(configPath, examplePath);
	let parsed;
	try {
		parsed = JSON.parse(rawConfig);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${detail}`);
	}
	return parseRoleConfig(parsed, sourcePath);
}
