import assert from "node:assert/strict";
import test from "node:test";
import { pickReviewer } from "../counter-review.ts";

const models = [
	{ provider: "anthropic", id: "claude-opus-5-5" },
	{ provider: "chatgpt", id: "gpt-6-astra" },
	{ provider: "deepseek", id: "deepseek-flash" },
];

test("claude author gets a gpt reviewer", () => {
	assert.equal(pickReviewer({ provider: "anthropic", id: "claude-sonnet-5" }, models)?.id, "gpt-6-astra");
});

test("gpt author gets a claude reviewer", () => {
	assert.equal(pickReviewer({ provider: "openai-codex", id: "gpt-6.1-sol" }, models)?.id, "claude-opus-5-5");
});

test("no counter model available", () => {
	assert.equal(pickReviewer({ provider: "chatgpt", id: "gpt-6-astra" }, models.slice(1)), undefined);
});
