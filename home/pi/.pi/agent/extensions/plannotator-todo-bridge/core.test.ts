import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	BRIDGE_OWNER,
	checkPlanSteps,
	completionMutations,
	extractDoneSteps,
	findExecuteMarkers,
	linkedMetadata,
	parseChecklist,
	reconcileChecklist,
	restoreBridgeState,
	serializeSisyphusObjective,
	type TodoSnapshot,
} from "./core.js";

function snapshot(tasks: TodoSnapshot["tasks"] = [], nextId = 1): TodoSnapshot {
	return { tasks, nextId };
}

test("parseChecklist matches Plannotator ordering and ignores indented checkboxes", () => {
	const items = parseChecklist("# Plan\n- [ ] first\n  * [x] nested\ntext\n- [X] third\n");
	assert.deepEqual(
		items.map(({ step, text, completed, line }) => ({ step, text, completed, line })),
		[
			{ step: 1, text: "first", completed: false, line: 1 },
			{ step: 2, text: "third", completed: true, line: 4 },
		],
	);
});

test("reconcileChecklist creates pending and checked tasks without duplicates", () => {
	const items = parseChecklist("- [ ] first\n- [x] second\n");
	const first = reconcileChecklist("PLAN.md", items, snapshot());
	assert.deepEqual(first.map((mutation) => mutation.action), ["create", "create", "update"]);
	assert.equal(first[2]?.params.id, 2);
	assert.equal(first[2]?.params.status, "completed");

	const existing = snapshot(
		items.map((item) => ({
			id: item.step,
			subject: item.text,
			status: item.completed ? "completed" : "pending",
			description: `Plannotator step ${item.step} from PLAN.md`,
			owner: BRIDGE_OWNER,
			metadata: linkedMetadata("PLAN.md", item.step),
		})),
		3,
	);
	assert.deepEqual(reconcileChecklist("PLAN.md", items, existing), []);
});

test("reconcileChecklist updates edited text and tombstones removed plan items", () => {
	const existing = snapshot(
		[
			{ id: 1, subject: "old", status: "pending", owner: BRIDGE_OWNER, metadata: linkedMetadata("PLAN.md", 1) },
			{ id: 2, subject: "removed", status: "pending", owner: BRIDGE_OWNER, metadata: linkedMetadata("PLAN.md", 2) },
		],
		3,
	);
	const mutations = reconcileChecklist("PLAN.md", parseChecklist("- [ ] new\n"), existing);
	assert.equal(mutations[0]?.action, "update");
	assert.equal(mutations[0]?.params.subject, "new");
	assert.deepEqual(mutations.at(-1), { action: "delete", params: { id: 2 } });
});

test("completionMutations changes only matching active linked tasks", () => {
	const tasks: TodoSnapshot["tasks"] = [
		{ id: 1, subject: "one", status: "pending", metadata: linkedMetadata("PLAN.md", 1) },
		{ id: 2, subject: "two", status: "completed", metadata: linkedMetadata("PLAN.md", 2) },
		{ id: 3, subject: "other", status: "pending", metadata: linkedMetadata("OTHER.md", 1) },
	];
	assert.deepEqual(completionMutations(snapshot(tasks, 4), "PLAN.md", [1, 2]), [
		{ action: "update", params: { id: 1, status: "completed" } },
	]);
	assert.deepEqual(extractDoneSteps("[DONE:1] x [done:1] [DONE:2]"), [1, 2]);
});

test("checkPlanSteps changes only matching checkbox bytes", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plan-bridge-"));
	try {
		const path = join(cwd, "PLAN.md");
		await writeFile(path, "# Keep\r\n- [ ] first\r\nparagraph [ ] untouched\r\n  - [ ] nested untouched\r\n- [ ] second\r\n", "utf8");
		assert.deepEqual(await checkPlanSteps(cwd, "PLAN.md", [2]), [2]);
		assert.equal(
			await readFile(path, "utf8"),
			"# Keep\r\n- [ ] first\r\nparagraph [ ] untouched\r\n  - [ ] nested untouched\r\n- [x] second\r\n",
		);
		assert.deepEqual(await checkPlanSteps(cwd, "PLAN.md", [2]), []);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("serializeSisyphusObjective preserves plan order and DONE identities", () => {
	const tasks: TodoSnapshot["tasks"] = [
		{ id: 3, subject: "third", status: "pending", metadata: linkedMetadata("PLAN.md", 3) },
		{ id: 1, subject: "first", status: "pending", metadata: linkedMetadata("PLAN.md", 1) },
		{ id: 2, subject: "done", status: "completed", metadata: linkedMetadata("PLAN.md", 2) },
	];
	const objective = serializeSisyphusObjective(tasks);
	assert.ok(objective.indexOf("1. first") < objective.indexOf("3. third"));
	assert.match(objective, /\[DONE:1\]/);
	assert.match(objective, /\[DONE:3\]/);
	assert.doesNotMatch(objective, /2\. done/);
	assert.throws(
		() =>
			serializeSisyphusObjective([
				{ id: 1, subject: "one", status: "pending", metadata: linkedMetadata("ONE.md", 1) },
				{ id: 2, subject: "two", status: "pending", metadata: linkedMetadata("TWO.md", 1) },
			]),
		/exactly one active plan/,
	);
});

test("marker and bridge state discovery follow the active branch", () => {
	const entries = [
		{ type: "custom", id: "m1", customType: "plannotator-execute", data: { lastSubmittedPath: "PLAN.md" } },
		{
			type: "custom",
			customType: "plannotator-todo-bridge",
			data: {
				processedMarkerIds: ["m1"],
				activePlanPath: "PLAN.md",
				pendingCompletions: [{ planPath: "PLAN.md", steps: [2] }],
			},
		},
	];
	assert.deepEqual(findExecuteMarkers(entries, "/repo"), [{ id: "m1", path: "PLAN.md", index: 0 }]);
	assert.deepEqual(restoreBridgeState(entries), {
		processedMarkerIds: ["m1"],
		activePlanPath: "PLAN.md",
		pendingCompletions: [{ planPath: "PLAN.md", steps: [2] }],
	});
});
