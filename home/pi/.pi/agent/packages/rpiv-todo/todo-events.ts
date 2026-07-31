import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyTaskMutation, type Op } from "./state/state-reducer.js";
import { commitState, getState } from "./state/store.js";
import type { TaskState } from "./state/state.js";
import type { TaskAction, TaskMutationParams } from "./tool/types.js";

export const TODO_REQUEST_CHANNEL = "rpiv-todo:request" as const;
export const TODO_SNAPSHOT_ENTRY = "rpiv-todo-snapshot" as const;

export interface TodoEventMutation {
	action: TaskAction;
	params?: TaskMutationParams;
}

export interface TodoEventSnapshot {
	tasks: TaskState["tasks"];
	nextId: number;
}

export type TodoEventResponse =
	| { status: "handled"; snapshot: TodoEventSnapshot; operations: Op[] }
	| { status: "error"; error: string }
	| { status: "unavailable"; error?: string };

export interface TodoEventRequest {
	requestId: string;
	action: "get" | "mutate";
	mutations?: TodoEventMutation[];
	origin?: string;
	respond: (response: TodoEventResponse) => void;
}

function cloneSnapshot(state: TaskState): TodoEventSnapshot {
	return {
		tasks: state.tasks.map((task) => ({
			...task,
			...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}),
			...(task.metadata ? { metadata: { ...task.metadata } } : {}),
		})),
		nextId: state.nextId,
	};
}

function isRequest(value: unknown): value is TodoEventRequest {
	if (!value || typeof value !== "object") return false;
	const request = value as Partial<TodoEventRequest>;
	return (
		(request.action === "get" || request.action === "mutate") &&
		typeof request.requestId === "string" &&
		typeof request.respond === "function"
	);
}

export function registerTodoEventListener(pi: ExtensionAPI, onChange: () => void): void {
	pi.events.on(TODO_REQUEST_CHANNEL, (value) => {
		if (!isRequest(value)) return;
		const request = value;

		try {
			if (request.action === "get") {
				request.respond({ status: "handled", snapshot: cloneSnapshot(getState()), operations: [] });
				return;
			}

			if (!Array.isArray(request.mutations) || request.mutations.length === 0) {
				request.respond({ status: "error", error: "mutate requires at least one mutation" });
				return;
			}

			let nextState = getState();
			const operations: Op[] = [];
			for (const mutation of request.mutations) {
				const result = applyTaskMutation(nextState, mutation.action, mutation.params ?? {});
				if (result.op.kind === "error") {
					request.respond({ status: "error", error: result.op.message });
					return;
				}
				nextState = result.state;
				operations.push(result.op);
			}

			commitState(nextState);
			const snapshot = cloneSnapshot(nextState);
			pi.appendEntry(TODO_SNAPSHOT_ENTRY, {
				...snapshot,
				origin: request.origin ?? "shared-event",
				requestId: request.requestId,
			});
			onChange();
			request.respond({ status: "handled", snapshot, operations });
		} catch (error) {
			request.respond({ status: "error", error: error instanceof Error ? error.message : String(error) });
		}
	});
}
