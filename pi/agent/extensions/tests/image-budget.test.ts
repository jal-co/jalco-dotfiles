import assert from "node:assert/strict";
import test from "node:test";
import { KEEP_RECENT_IMAGES, MAX_IMAGE_BYTES, OMITTED_NOTE, pruneImages } from "../image-budget.ts";

function image(bytes: number) {
	return { type: "image", mimeType: "image/png", data: "a".repeat(bytes) };
}

function toolResult(...content: unknown[]) {
	return { role: "toolResult", content };
}

test("keeps the newest images and replaces older ones with a note", () => {
	const messages = Array.from({ length: KEEP_RECENT_IMAGES + 3 }, (_, i) =>
		toolResult({ type: "text", text: `shot ${i}` }, image(10)),
	);
	const { messages: out, omitted } = pruneImages(messages);
	assert.equal(omitted, 3);
	assert.deepEqual(out[0].content, [{ type: "text", text: "shot 0" }, { type: "text", text: OMITTED_NOTE }]);
	assert.equal((out.at(-1)!.content as { type: string }[])[1].type, "image");
	assert.equal(out.filter((m) => (m.content as { type: string }[]).some((p) => p.type === "image")).length, KEEP_RECENT_IMAGES);
});

test("drops older images once the byte budget is spent", () => {
	const big = Math.floor(MAX_IMAGE_BYTES / 2) + 1;
	const { omitted, messages } = pruneImages([toolResult(image(big)), toolResult(image(big))]);
	assert.equal(omitted, 1);
	assert.deepEqual(messages[0].content, [{ type: "text", text: OMITTED_NOTE }]);
});

test("leaves messages untouched when nothing needs pruning", () => {
	const input = [{ role: "user", content: "hi" }, toolResult(image(10))];
	const { messages, omitted } = pruneImages(input);
	assert.equal(omitted, 0);
	assert.equal(messages[0], input[0]);
	assert.equal(messages[1], input[1]);
});
