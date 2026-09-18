import assert from "node:assert/strict";
import test from "node:test";
import { formatPonytailStatus } from "../footer-cleanup.ts";
import { formatProviderIcon, formatTokens } from "../lib/footer-format.ts";

const colorize = (color: string, text: string) => `[${color}]${text}`;

test("formats compact Ponytail modes", () => {
	assert.equal(
		formatPonytailStatus("● 🐴 ponytail: 🌿 LITE", colorize),
		"[accent] [warning]󱖿 [success] [muted]lite",
	);
	assert.equal(
		formatPonytailStatus("○ 🐴 ponytail: ⚡ FULL", colorize),
		"[dim] [warning]󱖿 [accent] [muted]full",
	);
});

test("formats provider icons and token counts", () => {
	assert.equal(formatProviderIcon("openai-codex-2", colorize), "[accent]");
	assert.equal(formatProviderIcon("anthropic", colorize), "[warning]");
	assert.equal(formatTokens(5_600), "6k");
	assert.equal(formatTokens(1_250_000), "1.3M");
});
