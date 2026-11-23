import assert from "node:assert/strict";
import test from "node:test";
import { changedBox, decodePng, encodePng, ghostDiff } from "./ghost-diff.mjs";

function page(width, height, blockTop) {
	const rgb = new Uint8ClampedArray(width * height * 3).fill(255);
	for (let y = blockTop; y < blockTop + 10; y++) for (let x = 20; x < 80; x++) rgb.set([0, 0, 0], (y * width + x) * 3);
	return { width, height, rgb };
}

test("PNG round trip keeps pixels", () => {
	const image = page(100, 60, 20);
	const back = decodePng(encodePng(image));
	assert.equal(back.width, 100);
	assert.equal(back.height, 60);
	assert.deepEqual([...back.rgb], [...image.rgb]);
});

test("identical screenshots produce nothing", () => {
	const image = page(100, 60, 20);
	assert.equal(changedBox(image, image), undefined);
	assert.equal(ghostDiff(image, image), undefined);
});

test("a moved block yields a ghost PNG and a two-frame looping GIF", () => {
	const result = ghostDiff(page(400, 300, 40), page(400, 300, 60));
	assert.ok(result);
	const ghost = decodePng(result.ghost);
	assert.ok(ghost.width > 0 && ghost.height > 0);
	assert.equal(result.flip.toString("ascii", 0, 6), "GIF89a");
	assert.ok(result.flip.includes(Buffer.from("NETSCAPE2.0")));
	const frame = Buffer.from([0x21, 0xf9, 4, 0, 90, 0, 0, 0, 0x2c]);
	let frames = 0;
	for (let at = result.flip.indexOf(frame); at >= 0; at = result.flip.indexOf(frame, at + 1)) frames++;
	assert.equal(frames, 2);
	assert.equal(result.flip.at(-1), 0x3b);
});

test("different sizes are refused instead of resized", () => {
	assert.throws(() => ghostDiff(page(100, 60, 20), page(100, 70, 20)), /Sizes differ/);
});
