import assert from "node:assert/strict";
import test from "node:test";
import { alignToolReferences } from "../tool-reference-alias-fix.ts";

const aliasedTools = [{ name: "mcp__extension__plannotator_submit_plan" }, { name: "bash" }];

function payloadWithReference(toolName: string, tools: unknown[] = aliasedTools) {
	return {
		tools,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: [{ type: "tool_reference", tool_name: toolName }],
					},
				],
			},
		],
	};
}

test("rewrites a flat tool reference to its mcp alias", () => {
	const result = alignToolReferences(payloadWithReference("plannotator_submit_plan"));
	assert.ok(result);
	const block = (result.messages as any)[0].content[0].content[0];
	assert.equal(block.tool_name, "mcp__extension__plannotator_submit_plan");
});

test("leaves a reference alone when the tool is already present", () => {
	assert.equal(alignToolReferences(payloadWithReference("bash")), undefined);
});

test("drops a reference with no matching tool", () => {
	const result = alignToolReferences(payloadWithReference("removed_tool"));
	assert.ok(result);
	assert.equal((result.messages as any)[0].content[0].content, "");
});

test("ignores payloads without tools or messages", () => {
	assert.equal(alignToolReferences({ messages: [] }), undefined);
	assert.equal(alignToolReferences({ tools: aliasedTools }), undefined);
	assert.equal(alignToolReferences("nonsense"), undefined);
});

test("keeps sibling blocks in a mixed tool result", () => {
	const payload = {
		tools: aliasedTools,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_2",
						content: [
							{ type: "text", text: "output" },
							{ type: "tool_reference", tool_name: "plannotator_submit_plan" },
						],
					},
				],
			},
		],
	};
	const result = alignToolReferences(payload);
	assert.ok(result);
	const content = (result.messages as any)[0].content[0].content;
	assert.equal(content.length, 2);
	assert.equal(content[0].text, "output");
	assert.equal(content[1].tool_name, "mcp__extension__plannotator_submit_plan");
});
