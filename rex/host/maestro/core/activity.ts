import { isString } from "./config/type-guards.ts";
import type {
	ActivityReadResult,
	SubagentActivityScope,
	SubagentActivityState,
} from "./types.ts";

const KNOWN_SCOPES: ReadonlySet<string> = new Set<SubagentActivityScope>([
	"agent",
	"turn",
	"provider",
	"streaming",
	"tool",
]);

export function isSubagentActivityScope(
	value: any,
): value is SubagentActivityScope {
	return isString(value) && KNOWN_SCOPES.has(value);
}

// pi-herdr-agents extension
export function projectActivity(
	state: SubagentActivityState | undefined,
): ActivityReadResult {
	return state === undefined
		? { ok: false, reason: "missing" }
		: { ok: true, activity: state };
}
