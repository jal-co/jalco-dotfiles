import assert from "node:assert/strict";
import test from "node:test";
import { KEEP_RECENT_IMAGES, MAX_IMAGE_BYTES, OMITTED_NOTE, PRUNE_STEP, pruneImages } from "../image-budget.ts";

function image(bytes: number) {
	return { type: "image", mimeType: "image/png", data: "a".repeat(bytes) };
}

function toolResult(...content: unknown[]) {
	return { role: "toolResult", content };
}

const shots = (count: number) => Array.from({ length: count }, (_, i) => toolResult({ type: "text", text: `shot ${i}` }, image(10)));
const imageCount = (messages: { content?: unknown }[]) => messages.filter((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image")).length;

test("keeps every image up to the recent limit", () => {
	const { messages, omitted } = pruneImages(shots(KEEP_RECENT_IMAGES));
	assert.equal(omitted, 0);
	assert.equal(imageCount(messages), KEEP_RECENT_IMAGES);
});

test("drops the oldest images in whole steps and replaces them with a note", () => {
	const { messages: out, omitted } = pruneImages(shots(KEEP_RECENT_IMAGES + 1));
	assert.equal(omitted, PRUNE_STEP);
	assert.deepEqual(out[0].content, [{ type: "text", text: "shot 0" }, { type: "text", text: OMITTED_NOTE }]);
	assert.equal((out.at(-1)!.content as { type: string }[])[1].type, "image");
	assert.equal(imageCount(out), KEEP_RECENT_IMAGES + 1 - PRUNE_STEP);
});

test("the set of omitted images changes only once per step, so cached history stays stable", () => {
	const omittedFor = (count: number) => pruneImages(shots(count)).omitted;
	const seen = new Set<number>();
	for (let count = 1; count <= KEEP_RECENT_IMAGES + 3 * PRUNE_STEP; count++) seen.add(omittedFor(count));
	assert.deepEqual([...seen].sort((a, b) => a - b), [0, PRUNE_STEP, 2 * PRUNE_STEP, 3 * PRUNE_STEP]);
	const first = pruneImages(shots(KEEP_RECENT_IMAGES + 1)).messages;
	const later = pruneImages(shots(KEEP_RECENT_IMAGES + PRUNE_STEP)).messages;
	assert.deepEqual(first, later.slice(0, first.length).map((m, i) => (i < first.length ? first[i] : m)).slice(0, first.length));
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
