import assert from "node:assert/strict";
import test from "node:test";
import { enterPlannotator, requestWithTimeout, startPlanningTask, type EventBus } from "./requests.js";

class FakeEvents implements EventBus {
	constructor(private readonly handler?: (channel: string, payload: any) => void) {}
	emit(channel: string, payload: unknown): void {
		this.handler?.(channel, payload);
	}
}

test("requestWithTimeout resolves one handled response", async () => {
	const events = new FakeEvents((_channel, payload) => payload.respond({ status: "handled" }));
	assert.deepEqual(await requestWithTimeout(events, "test", {}, 20), { status: "handled" });
});

test("requestWithTimeout rejects unavailable listeners", async () => {
	await assert.rejects(requestWithTimeout(new FakeEvents(), "missing", {}, 5), /did not respond within 5ms/);
});

test("startPlanningTask hands off only after planning is confirmed", async () => {
	const calls: string[] = [];
	const events = new FakeEvents((channel, payload) => {
		calls.push(channel);
		payload.respond({ status: "handled", result: { phase: "planning" } });
	});
	await startPlanningTask(events, "  build feature  ", (task) => calls.push(task), 20);
	assert.deepEqual(calls, ["plannotator:request", "build feature"]);
});

test("enterPlannotator requires confirmed planning phase", async () => {
	const planning = new FakeEvents((_channel, payload) =>
		payload.respond({ status: "handled", result: { phase: "planning" } }),
	);
	await enterPlannotator(planning, 20);

	const executing = new FakeEvents((_channel, payload) =>
		payload.respond({ status: "handled", result: { phase: "executing" } }),
	);
	await assert.rejects(enterPlannotator(executing, 20), /did not enter planning mode/);
});
