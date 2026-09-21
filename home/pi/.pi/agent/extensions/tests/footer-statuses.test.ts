import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	formatPonytailStatus,
	getBusyIndicator,
	loadBusyIndicatorMode,
	saveBusyIndicatorMode,
} from "../footer-cleanup.ts";
import { formatProviderIcon, formatTokens } from "../lib/footer-format.ts";

const colorize = (color: string, text: string) => `[${color}]${text}`;

test("builds switchable working indicators", () => {
	assert.deepEqual(getBusyIndicator("default", colorize), { frames: ["[accent]"], intervalMs: 0 });
	assert.deepEqual(getBusyIndicator("dot", colorize), { frames: ["[accent]●"], intervalMs: 0 });
	assert.equal(getBusyIndicator("pulse", colorize).frames.length, 4);
	assert.equal(getBusyIndicator("spinner", colorize).frames.length, 10);
	assert.deepEqual(getBusyIndicator("none", colorize), { frames: [], intervalMs: 0 });
});

test("saves the working indicator across extension reloads", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "footer-cleanup-"));
	const settingsPath = join(agentDir, "settings-extensions.json");
	try {
		assert.equal(loadBusyIndicatorMode(agentDir), "default");
		saveBusyIndicatorMode("pulse", agentDir);
		assert.equal(loadBusyIndicatorMode(agentDir), "pulse");
		assert.equal(JSON.parse(readFileSync(settingsPath, "utf8"))["footer-cleanup"].busyIndicator, "pulse");
	} finally {
		unlinkSync(settingsPath);
		rmdirSync(agentDir);
	}
});

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
