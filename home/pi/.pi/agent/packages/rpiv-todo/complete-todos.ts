import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyTaskMutation } from "./state/state-reducer.js";
import { commitState, getState } from "./state/store.js";
import type { TaskState } from "./state/state.js";
import type { TaskMutationParams } from "./tool/types.js";

export const COMPLETE_TODOS_TOOL = "complete_todos";

export interface CompleteTodosInput {
	ids?: number[] | string;
	allActive?: boolean;
	reason?: string;
}

export function resolveCompletionIds(state: TaskState, input: CompleteTodosInput): number[] {
	let ids: number[] | undefined;
	if (typeof input.ids === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(input.ids);
		} catch {
			throw new Error("`ids` was a string but not valid JSON.");
		}
		if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "number" && Number.isSafeInteger(id))) {
			throw new Error("`ids` must be an array of integer todo IDs.");
		}
		ids = parsed;
	} else if (input.ids !== undefined) {
		if (!input.ids.every((id) => Number.isSafeInteger(id))) {
			throw new Error("`ids` must be an array of integer todo IDs.");
		}
		ids = input.ids;
	}

	if (input.allActive === true && ids && ids.length > 0) {
		throw new Error("Use either `ids` or `allActive`, not both.");
	}
	if (input.allActive === true) {
		return state.tasks
			.filter((task) => task.status === "pending" || task.status === "in_progress")
			.map((task) => task.id);
	}
	if (!ids || ids.length === 0) throw new Error("Provide one or more `ids`, or set `allActive` to true.");

	const unique = [...new Set(ids)];
	for (const id of unique) {
		const task = state.tasks.find((candidate) => candidate.id === id);
		if (!task) throw new Error(`#${id} not found`);
		if (task.status === "deleted") throw new Error(`#${id} is deleted`);
	}
	return unique;
}

export function completeTodos(
	state: TaskState,
	input: CompleteTodosInput,
): { state: TaskState; selectedIds: number[]; completedIds: number[] } {
	const ids = resolveCompletionIds(state, input);
	let nextState = state;
	const completedIds: number[] = [];
	for (const id of ids) {
		const task = nextState.tasks.find((candidate) => candidate.id === id);
		if (!task || task.status === "completed") continue;
		const params: TaskMutationParams = { id, status: "completed" };
		if (input.reason?.trim()) params.metadata = { completionReason: input.reason.trim() };
		const result = applyTaskMutation(nextState, "update", params);
		if (result.op.kind === "error") throw new Error(result.op.message);
		nextState = result.state;
		completedIds.push(id);
	}
	return { state: nextState, selectedIds: ids, completedIds };
}

export function registerCompleteTodosTool(pi: ExtensionAPI, onChange: () => void): void {
	pi.registerTool({
		name: COMPLETE_TODOS_TOOL,
		label: "Complete Todos",
		description:
			"Mark selected todos, or every active todo, as completed. Use for explicit cleanup when work is already done but task state is stale. Pass ids for selected cleanup, or allActive=true for every pending and in-progress todo. These modes are mutually exclusive.",
		promptSnippet: "Complete selected or all active todos when cleaning up stale task state.",
		parameters: Type.Object({
			ids: Type.Optional(
				Type.Union([Type.Array(Type.Number()), Type.String()], {
					description: "Todo IDs to complete. Arrays may arrive JSON-encoded by some runtimes.",
				}),
			),
			allActive: Type.Optional(
				Type.Boolean({ description: "Complete every pending and in-progress todo. Must be explicitly true." }),
			),
			reason: Type.Optional(Type.String({ description: "Optional cleanup reason stored in task metadata." })),
		}),
		async execute(_toolCallId, input) {
			const result = completeTodos(getState(), input);
			commitState(result.state);
			if (result.completedIds.length > 0) onChange();
			const selected = result.selectedIds;
			const alreadyComplete = selected.length - result.completedIds.length;
			const content =
				result.completedIds.length > 0
					? `Completed ${result.completedIds.map((id) => `#${id}`).join(", ")}${alreadyComplete > 0 ? `; ${alreadyComplete} already complete` : ""}.`
					: selected.length > 0
						? `No changes; ${selected.length} selected todo${selected.length === 1 ? " was" : "s were"} already complete.`
						: "No active todos to complete.";
			return {
				content: [{ type: "text", text: content }],
				details: {
					action: "update",
					params: { ids: selected, allActive: input.allActive === true, reason: input.reason },
					tasks: result.state.tasks,
					nextId: result.state.nextId,
				},
			};
		},
	});
}
