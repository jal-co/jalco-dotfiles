import assert from "node:assert/strict";
import test from "node:test";
import { formatJevResult } from "./core.ts";

test("formats model handoff and verification states", () => {
	const textRequest = {
		goal: "Search",
		field: { label: "Origin" },
		page: { title: "Flights", text: "Origin" },
		recent_actions: [],
	};
	assert.match(formatJevResult({ status: "needs_text", text_request: textRequest }), /exact value/);
	assert.match(formatJevResult({ status: "done" }), /Verify every requested outcome/);
	assert.match(formatJevResult({ status: "blocked" }), /Never switch to desktop control/);
});
