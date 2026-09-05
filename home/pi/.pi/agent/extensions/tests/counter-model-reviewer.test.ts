import assert from "node:assert/strict";
import test from "node:test";
import counterModelReviewer, { resolveReviewerModel } from "../counter-model-reviewer.ts";

function reviewerHandler() {
	let handler: ((event: any, context: any) => any) | undefined;
	counterModelReviewer({
		on(event: string, candidate: (event: any, context: any) => any) {
			if (event === "tool_call") handler = candidate;
		},
	} as any);
	assert.ok(handler);
	return handler;
}

test("routes OpenAI authors to Opus", () => {
	assert.equal(
		resolveReviewerModel("openai-codex", "gpt-5.6-sol"),
		"anthropic/claude-opus-5",
	);
});

test("routes Anthropic authors to Sol", () => {
	assert.equal(
		resolveReviewerModel("anthropic", "claude-opus-5"),
		"openai-codex/gpt-5.6-sol",
	);
});

test("recognizes model families behind another provider", () => {
	assert.equal(
		resolveReviewerModel("cursor", "gpt-5.6-sol@1m"),
		"anthropic/claude-opus-5",
	);
	assert.equal(
		resolveReviewerModel("cursor", "claude-opus-5@1m"),
		"openai-codex/gpt-5.6-sol",
	);
});

test("rejects unsupported model families", () => {
	assert.equal(resolveReviewerModel("google", "gemini-3-pro"), undefined);
});

test("rewrites reviewer spawns to the counter-provider model", () => {
	const input = { agent_type: "reviewer", model: "anthropic/claude-sonnet-5" };
	const result = reviewerHandler()(
		{ toolName: "spawn_agent", input },
		{ model: { provider: "openai-codex", id: "gpt-5.6-sol" } },
	);
	assert.equal(result, undefined);
	assert.equal(input.model, "anthropic/claude-opus-5");
});

test("leaves other subagent templates unchanged", () => {
	const input = { agent_type: "scout" };
	reviewerHandler()(
		{ toolName: "spawn_agent", input },
		{ model: { provider: "openai-codex", id: "gpt-5.6-sol" } },
	);
	assert.deepEqual(input, { agent_type: "scout" });
});

test("blocks reviewer spawns from unsupported parent models", () => {
	const result = reviewerHandler()(
		{ toolName: "spawn_agent", input: { agent_type: "reviewer" } },
		{ model: { provider: "google", id: "gemini-3-pro" } },
	);
	assert.deepEqual(result, {
		block: true,
		reason: "No counter-provider reviewer is configured for google/gemini-3-pro.",
	});
});
