import {
	DEFAULT_REQUEST_TIMEOUT_MS,
	makeRequestId,
	PLANNOTATOR_REQUEST_CHANNEL,
	TODO_REQUEST_CHANNEL,
	type TodoMutation,
	type TodoSnapshot,
} from "./core.js";

export interface EventBus {
	emit(channel: string, payload: unknown): void;
}

export type PlannotatorModeResponse =
	| { status: "handled"; result: { phase: "idle" | "planning" | "executing" } }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

export type TodoResponse =
	| { status: "handled"; snapshot: TodoSnapshot; operations: unknown[] }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

export function requestWithTimeout<T>(
	events: EventBus,
	channel: string,
	payload: Record<string, unknown>,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error(`${channel} did not respond within ${timeoutMs}ms`));
		}, timeoutMs);
		const respond = (response: T): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(response);
		};
		events.emit(channel, { ...payload, respond });
	});
}

export async function enterPlannotator(events: EventBus, timeoutMs?: number): Promise<void> {
	const response = await requestWithTimeout<PlannotatorModeResponse>(
		events,
		PLANNOTATOR_REQUEST_CHANNEL,
		{
			requestId: makeRequestId("plan-mode"),
			action: "plan-mode",
			payload: { mode: "enter" },
		},
		timeoutMs,
	);
	if (response.status !== "handled") {
		throw new Error(response.error || "Plannotator plan mode is unavailable.");
	}
	if (response.result.phase !== "planning") {
		throw new Error(`Plannotator did not enter planning mode (phase: ${response.result.phase}).`);
	}
}

export async function startPlanningTask(
	events: EventBus,
	task: string,
	handoff: (task: string) => void,
	timeoutMs?: number,
): Promise<void> {
	const trimmed = task.trim();
	if (!trimmed) throw new Error("A planning task is required.");
	await enterPlannotator(events, timeoutMs);
	handoff(trimmed);
}

export async function getTodos(events: EventBus, timeoutMs?: number): Promise<TodoSnapshot> {
	const response = await requestWithTimeout<TodoResponse>(
		events,
		TODO_REQUEST_CHANNEL,
		{
			requestId: makeRequestId("todo-get"),
			action: "get",
			origin: "plannotator-todo-bridge",
		},
		timeoutMs,
	);
	if (response.status !== "handled") throw new Error(response.error || "rpiv-todo shared event API is unavailable.");
	return response.snapshot;
}

export async function mutateTodos(events: EventBus, mutations: TodoMutation[], timeoutMs?: number): Promise<TodoSnapshot> {
	if (mutations.length === 0) return getTodos(events, timeoutMs);
	const response = await requestWithTimeout<TodoResponse>(
		events,
		TODO_REQUEST_CHANNEL,
		{
			requestId: makeRequestId("todo-mutate"),
			action: "mutate",
			origin: "plannotator-todo-bridge",
			mutations,
		},
		timeoutMs,
	);
	if (response.status !== "handled") throw new Error(response.error || "rpiv-todo mutation failed.");
	return response.snapshot;
}
