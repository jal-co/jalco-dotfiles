import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, ToolResultMessage, UserMessage, Usage } from "@earendil-works/pi-ai";
import { defaultConfig } from "./config.ts";
import { compactForPi } from "./core.ts";
import { renderCompactedHistory, toCompactionMessages } from "./messages.ts";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage,
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function result(id: string, text: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: [{ type: "text", text }],
		isError,
		timestamp: 1,
	};
}

test("maps Pi tool calls and renders retained history", () => {
	const mapped = toCompactionMessages([
		user("Fix the test"),
		assistant([
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "I will inspect the file." },
			{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
		]),
		result("t1", "file contents"),
	]);
	assert.deepEqual(mapped[1]?.toolUses[0], {
		tool_use_id: "t1",
		tool: "read",
		input: { path: "a.ts" },
	});
	assert.equal(mapped[1]?.text, "I will inspect the file.");
	assert.equal(mapped[2]?.toolResults?.[0]?.text, "file contents");
	assert.doesNotMatch(renderCompactedHistory(mapped), /private reasoning/);
	assert.match(renderCompactedHistory(mapped), /\[Assistant tool call read t1\]/);
	assert.match(renderCompactedHistory(mapped), /\[Tool result t1\]\nfile contents/);
});

test("uses Jev decisions and prepends the previous compacted history", async () => {
	const messages = [
		user("Fix the test"),
		assistant([{ type: "toolCall", id: "old", name: "read", arguments: { path: "a.ts" } }]),
		result("old", "obsolete output"),
		assistant([{ type: "toolCall", id: "keep", name: "bash", arguments: { command: "npm test" } }]),
		result("keep", "FAIL expected 2", true),
		assistant([{ type: "text", text: "The test still fails." }]),
		user("continue"),
	];
	const fetcher = async (..._args: Parameters<typeof fetch>): Promise<Response> =>
		new Response(
			JSON.stringify({
				answers: {
					call_t1: { noul: 0.1 },
					result_t1: { noul: 0.1 },
					call_t2: { noul: 0.9 },
					result_t2: { noul: 0.9 },
				},
			}),
			{ status: 200 },
		);
	const output = await compactForPi(
		messages,
		"[User]\nEarlier constraint",
		undefined,
		{ ...defaultConfig, preserveRecentMessages: 1 },
		"test-key",
		undefined,
		fetcher,
	);
	assert.deepEqual(output.result.decisions.map(decision => decision.action), ["drop_call", "keep"]);
	assert.match(output.summary, /^\[User\]\nEarlier constraint/);
	assert.doesNotMatch(output.summary, /obsolete output/);
	assert.match(output.summary, /FAIL expected 2/);
});
