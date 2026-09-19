import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import footerCleanup, { formatPonytailStatus, getBusyIndicator } from "../footer-cleanup.ts";
import { formatProviderIcon, formatTokens } from "../lib/footer-format.ts";

const colorize = (color: string, text: string) => `[${color}]${text}`;

test("builds switchable footer indicators", () => {
	assert.deepEqual(getBusyIndicator("default", colorize), { frames: ["[accent]"], intervalMs: 0 });
	assert.deepEqual(getBusyIndicator("dot", colorize), { frames: ["[accent]●"], intervalMs: 0 });
	assert.equal(getBusyIndicator("pulse", colorize).frames.length, 4);
	assert.equal(getBusyIndicator("spinner", colorize).frames.length, 10);
	assert.deepEqual(getBusyIndicator("none", colorize), { frames: [], intervalMs: 0 });
});

test("shows and switches the footer icon only while Pi is busy", async () => {
	type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
	type Command = { handler: (args: string, ctx: Record<string, unknown>) => unknown };
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const statuses = new Map<string, string | undefined>();
	const ui = {
		theme: { fg: colorize },
		setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
		notify: () => undefined,
	};
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		events: { on: () => undefined },
	} as unknown as ExtensionAPI;
	const emit = async (event: string, payload: Record<string, unknown> = {}) => {
		const handler = handlers.get(event);
		assert.ok(handler);
		await handler(payload, { hasUI: true, ui });
	};

	footerCleanup(pi);
	await emit("session_start");
	await emit("agent_start");
	assert.equal(statuses.get("busy"), "[accent]");
	await commands.get("footer-indicator")?.handler("dot", { ui });
	assert.equal(statuses.get("busy"), "[accent]●");
	await commands.get("footer-indicator")?.handler("none", { ui });
	assert.equal(statuses.get("busy"), undefined);
	await emit("agent_settled");
	assert.equal(statuses.get("busy"), undefined);
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
