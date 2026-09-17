import assert from "node:assert/strict";
import test from "node:test";
import { directAgentBrowserAction, formatJevResult } from "./core.ts";

test("detects direct Agent Browser actions", () => {
	assert.equal(directAgentBrowserAction('agent-browser --session "$session" click @e1'), "click");
	assert.equal(directAgentBrowserAction('set -e; "$BROWSER" fill @e2 "Zurich"'), "fill");
	assert.equal(directAgentBrowserAction("/tmp/mastra-browser scroll down 500"), "scroll");
});

test("allows read-only Agent Browser commands", () => {
	assert.equal(directAgentBrowserAction("agent-browser snapshot -i"), undefined);
	assert.equal(directAgentBrowserAction("agent-browser screenshot result.png"), undefined);
	assert.equal(directAgentBrowserAction("agent-browser a11y"), undefined);
});

test("does not block commands that mention Agent Browser as data", () => {
	assert.equal(directAgentBrowserAction('grep -R "agent-browser click" .'), undefined);
	assert.equal(directAgentBrowserAction('printf "%s" "agent-browser fill"'), undefined);
});

test("formats model handoff and verification states", () => {
	const textRequest = {
		goal: "Search",
		field: { label: "Origin" },
		page: { title: "Flights", text: "Origin" },
		recent_actions: [],
	};
	assert.match(formatJevResult({ status: "needs_text", text_request: textRequest }), /exact value/);
	assert.match(formatJevResult({ status: "done" }), /Verify every requested outcome/);
	assert.match(formatJevResult({ status: "blocked" }), /instead of bypassing Jev/);
});
