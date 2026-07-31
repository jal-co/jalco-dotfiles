import assert from "node:assert/strict";
import test from "node:test";
import { replayFromBranch } from "./state/replay.js";
import { __resetState, getState } from "./state/store.js";
import { registerTodoEventListener, TODO_REQUEST_CHANNEL, TODO_SNAPSHOT_ENTRY } from "./todo-events.js";

function harness() {
	let listener: ((value: unknown) => void) | undefined;
	const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
	let refreshes = 0;
	const pi = {
		events: {
			on(channel: string, handler: (value: unknown) => void) {
				assert.equal(channel, TODO_REQUEST_CHANNEL);
				listener = handler;
			},
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
	};
	registerTodoEventListener(pi as never, () => {
		refreshes += 1;
	});
	return {
		entries,
		get refreshes() {
			return refreshes;
		},
		request(value: Record<string, unknown>) {
			return new Promise<any>((resolve) => listener?.({ requestId: "r1", ...value, respond: resolve }));
		},
	};
}

test("shared mutations commit one replayable snapshot and refresh once", async () => {
	__resetState();
	const h = harness();
	const response = await h.request({
		action: "mutate",
		mutations: [
			{ action: "create", params: { subject: "one" } },
			{ action: "update", params: { id: 1, status: "completed" } },
		],
	});
	assert.equal(response.status, "handled");
	assert.equal(getState().tasks[0]?.status, "completed");
	assert.equal(h.entries[0]?.customType, TODO_SNAPSHOT_ENTRY);
	assert.equal(h.refreshes, 1);
	assert.deepEqual(replayFromBranch({ sessionManager: { getBranch: () => h.entries } }), getState());
});

test("shared mutation batches fail atomically", async () => {
	__resetState();
	const h = harness();
	const response = await h.request({
		action: "mutate",
		mutations: [
			{ action: "create", params: { subject: "one" } },
			{ action: "update", params: { id: 99, status: "completed" } },
		],
	});
	assert.equal(response.status, "error");
	assert.equal(getState().tasks.length, 0);
	assert.equal(h.entries.length, 0);
	assert.equal(h.refreshes, 0);
});
