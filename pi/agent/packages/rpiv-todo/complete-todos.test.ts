import assert from "node:assert/strict";
import test from "node:test";
import { completeTodos, resolveCompletionIds } from "./complete-todos.js";
import type { TaskState } from "./state/state.js";

const state: TaskState = {
	nextId: 5,
	tasks: [
		{ id: 1, subject: "pending", status: "pending" },
		{ id: 2, subject: "active", status: "in_progress" },
		{ id: 3, subject: "done", status: "completed" },
		{ id: 4, subject: "gone", status: "deleted" },
	],
};

test("selected cleanup completes pending tasks and keeps completed tasks idempotent", () => {
	const result = completeTodos(state, { ids: [1, 3], reason: "cleanup" });
	assert.deepEqual(result.selectedIds, [1, 3]);
	assert.deepEqual(result.completedIds, [1]);
	assert.equal(result.state.tasks[0]?.status, "completed");
	assert.equal(result.state.tasks[0]?.metadata?.completionReason, "cleanup");
	assert.equal(result.state.tasks[2]?.status, "completed");
});

test("all-active cleanup completes every pending and in-progress task", () => {
	const result = completeTodos(state, { allActive: true });
	assert.deepEqual(result.selectedIds, [1, 2]);
	assert.deepEqual(result.completedIds, [1, 2]);
	assert.equal(result.state.tasks[0]?.status, "completed");
	assert.equal(result.state.tasks[1]?.status, "completed");
});

test("cleanup validates mutually exclusive modes and IDs", () => {
	assert.throws(() => resolveCompletionIds(state, { ids: [1], allActive: true }), /either `ids` or `allActive`/);
	assert.throws(() => resolveCompletionIds(state, {}), /Provide one or more/);
	assert.throws(() => resolveCompletionIds(state, { ids: [99] }), /#99 not found/);
	assert.throws(() => resolveCompletionIds(state, { ids: "not-json" }), /not valid JSON/);
	assert.deepEqual(resolveCompletionIds(state, { ids: "[2,1,2]" }), [2, 1]);
});
