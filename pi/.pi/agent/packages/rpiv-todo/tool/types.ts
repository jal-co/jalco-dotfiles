import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// Tool / command identity — verbatim string boundaries.
// Tool name "todo" is the persistence key for branch replay (filtering
// `toolResult.toolName === "todo"`) AND the permissions entry at
// `templates/pi-permissions.jsonc:26`. DO NOT rename.
// ---------------------------------------------------------------------------

export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";

// ---------------------------------------------------------------------------
// User-facing strings (kept stable for /todos UX parity).
// ---------------------------------------------------------------------------

export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Persistence + replay snapshot. Every successful `todo` tool call returns this
 * shape under `details`; `state/replay.ts` reads the latest one from the branch
 * to reconstruct module state. Field order and field names are pinned by
 * cross-version replay compatibility.
 */
export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

/**
 * Open-shape input bag the reducer accepts. Stays an interface so the index
 * signature (`[key: string]: unknown`) lets the runtime pass through TypeBox
 * `Static<typeof TodoParamsSchema>` without `as` casts.
 */
export interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// TypeBox parameter schema — every `description` doubles as LLM-facing prompt
// copy. Field order and wording are pinned by registration tests and the
// pre-refactor schema at `packages/rpiv-todo/todo.ts:512-573`.
// ---------------------------------------------------------------------------

export const TodoParamsSchema = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
	description: Type.Optional(Type.String({ description: "Long-form task description" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description: "Target status (update) or list filter (list)",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export type TodoParams = Static<typeof TodoParamsSchema>;

// ---------------------------------------------------------------------------
// LOCAL FORK PATCH — wire-level schema tolerant of stringified container args.
//
// Some pi runtimes / model adapters deliver nested tool arguments (arrays,
// records) JSON-encoded as a *string* (double-encoding). With the strict
// `TodoParamsSchema`, pre-execute validation then rejects calls that pass
// `blockedBy` / `addBlockedBy` / `removeBlockedBy` / `metadata` with errors
// like `blockedBy.0: must be number`. This schema accepts EITHER the structured
// value OR a JSON string for those fields; `execute()` JSON.parse-coerces the
// string back before the reducer runs. Scalar fields are unchanged.
// ---------------------------------------------------------------------------

/** Field names whose values may arrive JSON-stringified and need coercion. */
export const COERCIBLE_FIELDS = ["blockedBy", "addBlockedBy", "removeBlockedBy", "metadata"] as const;

const NumberArrayOrJson = (description: string) =>
	Type.Optional(Type.Union([Type.Array(Type.Number()), Type.String()], { description }));

export const TodoParamsWireSchema = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
	description: Type.Optional(Type.String({ description: "Long-form task description" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description: "Target status (update) or list filter (list)",
		}),
	),
	blockedBy: NumberArrayOrJson("Initial blockedBy ids (create only)"),
	addBlockedBy: NumberArrayOrJson("Task ids to add to blockedBy (update only, additive merge)"),
	removeBlockedBy: NumberArrayOrJson("Task ids to remove from blockedBy (update only, additive merge)"),
	owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
	metadata: Type.Optional(
		Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.String()], {
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(Type.Number({ description: "Task id (required for update, get, delete)" })),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

/**
 * LOCAL FORK PATCH — coerce JSON-stringified container fields back to structures.
 * Returns either the coerced params or an error message naming the bad field.
 */
export function coerceTodoParams(
	params: Record<string, unknown>,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
	const out: Record<string, unknown> = { ...params };
	for (const key of COERCIBLE_FIELDS) {
		const val = out[key];
		if (typeof val !== "string") continue;
		try {
			out[key] = JSON.parse(val);
		} catch {
			return { ok: false, error: `\`${key}\` was a string but not valid JSON.` };
		}
	}
	for (const key of ["blockedBy", "addBlockedBy", "removeBlockedBy"] as const) {
		const val = out[key];
		if (val === undefined) continue;
		if (!Array.isArray(val) || !val.every((n) => typeof n === "number")) {
			return { ok: false, error: `\`${key}\` must be an array of numbers.` };
		}
	}
	if (out.metadata !== undefined && (typeof out.metadata !== "object" || out.metadata === null || Array.isArray(out.metadata))) {
		return { ok: false, error: "`metadata` must be an object." };
	}
	return { ok: true, params: out };
}
