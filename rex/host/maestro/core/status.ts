import { readFileSync } from "node:fs";
import { isBoolean, isPlainObject } from "./config/type-guards.ts";

export const DEFAULT_STATUS_LINE_LIMIT = 4;
export const MAX_STATUS_NAME_LENGTH = 72;

export type SubagentStatusKind = "starting" | "active" | "waiting" | "stalled";
export type SubagentStatusTransition = "stalled" | "recovered" | null;
export type StatusSnapshotState =
	| "unseen"
	| "present"
	| "missing"
	| "invalid"
	| "wrong-id";
export type StatusActivityPhase = "starting" | "active" | "waiting" | "done";

export interface StatusConfig {
	enabled: boolean;
	lineLimit: number;
}

export type StatusObservation =
	| {
			snapshot: "present";
			updatedAt: number;
			sequence: number;
			phase: StatusActivityPhase;
			active?: boolean;
			activeScope?: string;
			activeSince?: number;
			waitingSince?: number;
			latestEvent?: string;
			activityLabel?: string;
	  }
	| {
			snapshot: "missing" | "invalid" | "wrong-id";
			snapshotError?: string;
	  };

export interface SubagentStatusState {
	startTimeMs: number;
	firstObservationAtMs: number | null;
	lastActivityAtMs: number | null;
	lastActivitySequence: number | null;
	localOverrideAtMs: number | null;
	localOverrideSequence: number | null;
	activeNow: boolean;
	activeSinceMs: number | null;
	activeScope: string | null;
	waitingSinceMs: number | null;
	phase: StatusActivityPhase | null;
	latestEvent: string | null;
	activityLabel: string | null;
	snapshotState: StatusSnapshotState;
	snapshotProblemSinceMs: number | null;
	snapshotError: string | null;
	currentKind: SubagentStatusKind;
}

export interface StatusSnapshot {
	kind: SubagentStatusKind;
	elapsedMs: number;
	elapsedText: string;
	activeSinceMs: number | null;
	activeDurationText: string | null;
	activeScope: string | null;
	waitingSinceMs: number | null;
	waitingDurationText: string | null;
	latestEvent: string | null;
	activityLabel: string | null;
	snapshotState: StatusSnapshotState;
	snapshotError: string | null;
	snapshotProblemText: string | null;
	statusLabel: string | null;
}

export interface CappedStatusLines {
	visibleLines: string[];
	overflow: number;
}

function invalidStatusConfig(source: string, message: string): never {
	throw new Error(`Invalid subagent status config in ${source}: ${message}`);
}

function requireObject(value: any, source: string, fieldName: string) {
	if (!isPlainObject(value)) {
		invalidStatusConfig(source, `${fieldName} must be an object`);
	}
	return value;
}

function requireBoolean(
	value: any,
	source: string,
	fieldName: string,
): boolean {
	if (!isBoolean(value)) {
		invalidStatusConfig(source, `${fieldName} must be a boolean`);
	}
	return value;
}

function rejectUnsupportedKeys(
	value: any,
	allowedKeys: string[],
	source: string,
	fieldName: string,
): void {
	const unsupportedKeys = Object.keys(value).filter(
		(key) => !allowedKeys.includes(key),
	);
	if (unsupportedKeys.length > 0) {
		invalidStatusConfig(
			source,
			`${fieldName} has unsupported key(s): ${unsupportedKeys.join(", ")}`,
		);
	}
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= 1) return text.slice(0, maxLength);
	return `${text.slice(0, maxLength - 1)}…`;
}

export function normalizeStatusName(name: string): string {
	const collapsed = name.replace(/\s+/g, " ").trim() || "subagent";
	return truncateText(collapsed, MAX_STATUS_NAME_LENGTH);
}

export function parseStatusConfig(
	rawConfig: any,
	source = "config.json",
): StatusConfig {
	const config = requireObject(rawConfig, source, "root");
	const status = requireObject(config.status, source, "status");
	rejectUnsupportedKeys(status, ["enabled"], source, "status");
	const enabled = requireBoolean(status.enabled, source, "status.enabled");

	return {
		enabled,
		lineLimit: DEFAULT_STATUS_LINE_LIMIT,
	};
}

interface StatusConfigSource {
	sourcePath: string;
	rawConfig: string;
}

function readStatusConfigFile(
	configPath: string,
	examplePath: string,
): StatusConfigSource {
	try {
		return {
			sourcePath: configPath,
			rawConfig: readFileSync(configPath, "utf8"),
		};
	} catch (error) {
		// SAFETY: readFileSync only throws Node's fs errors here, which are
		// always Error instances carrying an ErrnoException `code`.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code !== "ENOENT") throw error;
	}

	try {
		return {
			sourcePath: examplePath,
			rawConfig: readFileSync(examplePath, "utf8"),
		};
	} catch (error) {
		// SAFETY: see above.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code === "ENOENT") {
			throw new Error(
				`Missing subagent status config. Expected ${configPath} or ${examplePath}.`,
			);
		}
		throw error;
	}
}

export function loadStatusConfig(
	configPath: string,
	examplePath: string,
): StatusConfig {
	const { sourcePath, rawConfig } = readStatusConfigFile(
		configPath,
		examplePath,
	);

	let parsed;
	try {
		parsed = JSON.parse(rawConfig);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${detail}`);
	}

	return parseStatusConfig(parsed, sourcePath);
}

export function formatElapsedDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;

	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;

	return `${minutes}m`;
}

export interface StatusAdvance {
	nextState: SubagentStatusState;
	snapshot: StatusSnapshot;
	transition: SubagentStatusTransition;
}

export function capStatusLines(
	lines: string[],
	lineLimit: number,
): CappedStatusLines {
	const visibleLines = lines.slice(0, lineLimit);
	return {
		visibleLines,
		overflow: Math.max(0, lines.length - visibleLines.length),
	};
}

export function formatStatusAggregate(
	lines: string[],
	lineLimit: number,
): string {
	const { visibleLines, overflow } = capStatusLines(lines, lineLimit);
	const bulletLines = visibleLines.map((line) => `• ${line}`);
	if (overflow > 0) bulletLines.push(`• +${overflow} more running.`);
	return `Subagent status:\n${bulletLines.join("\n")}`;
}
