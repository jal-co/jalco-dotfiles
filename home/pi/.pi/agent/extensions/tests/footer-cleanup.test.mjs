import assert from "node:assert/strict";
import { createRequire, findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";

const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = require("jiti");
const runtimeEntry = pathToFileURL(realpathSync(join(dirname(process.execPath), "pi")));
const jiti = createJiti(import.meta.url, {
	alias: Object.fromEntries(["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].map((name) => [
		name, join(dirname(findPackageJSON(name, runtimeEntry)), "dist/index.js"),
	])),
});
const { default: footerCleanup, FramedEditor, formatWorkingMessage } = await jiti.import("../footer-cleanup.ts");
const { visibleWidth, CURSOR_MARKER, rgbColor, styleText } = await jiti.import("@earendil-works/pi-tui");
const { getFrameLabels } = await jiti.import("../lib/footer-format.ts");

const stubUI = () => ({ setEditorComponent() {}, setStatus() {}, setWorkingIndicator() {}, setWorkingMessage() {}, theme: { fg: (_color, text) => text } });

test("hidden footer leaves the native working indicator visible", async (t) => {
	const handlers = new Map();
	const setFooter = t.mock.fn();
	const setWorkingVisible = t.mock.fn();
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	await handlers.get("session_start")({}, { hasUI: true, mode: "tui", ui: { ...stubUI(), setFooter, setWorkingVisible } });
	assert.equal(setFooter.mock.callCount(), 1);
	assert.equal(setWorkingVisible.mock.callCount(), 0);
});

test("spinner and elapsed time sit in the Amp-style top border", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map();
	const setEditorComponent = t.mock.fn();
	const ui = {
		setEditorComponent,
		setStatus() {},
		setWorkingIndicator() {},
		setWorkingMessage() {},
		setFooter() {},
		theme: { fg: (_color, text) => text },
	};
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	await handlers.get("session_start")({}, { hasUI: true, mode: "tui", ui, cwd: join(homedir(), "dotfiles"), sessionManager: { getEntries: () => [] }, getContextUsage: () => undefined });
	const factory = setEditorComponent.mock.calls[0].arguments[0];
	const editor = factory({ terminal: { rows: 40 }, requestRender() {} }, { borderColor: (text) => text }, { matches: () => false });
	assert.equal(editor.embedWorkingStatus, true);
	editor.setWorkingStatusIndicator({ renderInBorder: () => "⠋ 2s", renderSpinnerInBorder: () => "⠋" });
	editor.setText("my next prompt");
	assert.equal(editor.getText(), "my next prompt");
	editor.borderColor = () => { throw new Error("Reasoning color must not override the muted frame"); };
	const lines = editor.render(48);
	assert.ok(lines[0].startsWith("╭") && lines[0].includes("⠋ 2s"));
	assert.equal(lines.length, 3);
	assert.ok(lines[1].startsWith("│  my next prompt"));
	assert.ok(lines[2].startsWith("╰"));
	await handlers.get("session_shutdown")();
});

test("wrapped input preserves column widths, cursor, and mouse coordinates", () => {
	const editor = new FramedEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text },
		{ matches: () => false },
		{ paddingX: 3, embedWorkingStatus: true },
	);
	editor.setPaddingX(0);
	assert.equal(editor.getPaddingX(), 3);
	editor.focused = true;
	for (const width of [1, 4, 5, 20, 48, 80, 140]) {
		editor.setText(width === 1 ? "" : width < 20 ? "abc" : "👩🏽‍💻 汉字 é " + "long text ".repeat(20));
		const lines = editor.render(width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), JSON.stringify({ width, lines }));
		assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
		if (width >= 5) {
			assert.ok(lines[0].startsWith("╭") && lines[0].endsWith("╮"));
			assert.ok(lines.at(-1).startsWith("╰") && lines.at(-1).endsWith("╯"));
			assert.ok(lines.slice(1, -1).every((line) => line.startsWith("│") && line.endsWith("│")));
		}
	}
	editor.setText("abcd");
	editor.render(80);
	editor.handleMouse({ type: "click", button: "left", x: 4, y: 1, width: 80, height: 3 });
	assert.equal(editor.getCursor().col, 1);
});

test("autocomplete stays below the frame and retains keyboard selection", async (t) => {
	const identity = (text) => text;
	const editor = new FramedEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } },
		{ matches: () => false },
		{ paddingX: 3, embedWorkingStatus: true },
	);
	editor.setAutocompleteProvider({
		getSuggestions: () => ({ items: [{ value: "hello", label: "hello" }, { value: "help", label: "help" }], prefix: "/" }),
		applyCompletion: (_lines, _line, _col, item) => ({ lines: [`/${item.value}`], cursorLine: 0, cursorCol: item.value.length + 1 }),
	});
	editor.setText("/");
	editor.handleInput("\t");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const lines = editor.render(48);
	const bottom = lines.findIndex((line) => line.startsWith("╰"));
	assert.ok(bottom > 0);
	assert.ok(lines.slice(bottom + 1).some((line) => line.includes("hello")));
	assert.ok(lines.every((line) => visibleWidth(line) <= 48));
	const onSubmit = t.mock.fn();
	editor.onSubmit = onSubmit;
	editor.handleInput("\x1b[B");
	editor.handleInput("\r");
	assert.equal(onSubmit.mock.calls[0].arguments[0], "/help");
	editor.setText("/");
	editor.handleInput("\t");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const mouseLines = editor.render(48);
	const mouseBottom = mouseLines.findIndex((line) => line.startsWith("╰"));
	editor.handleMouse({ type: "click", button: "left", x: 3, y: mouseBottom, width: 48, height: mouseLines.length });
	assert.equal(onSubmit.mock.callCount(), 1);
	editor.handleMouse({ type: "click", button: "left", x: 3, y: mouseBottom + 2, width: 48, height: mouseLines.length });
	assert.equal(editor.getText(), "/help");
});

test("model branding and session metrics fit the frame without crowding the timer", () => {
	const context = {
		cwd: join(homedir(), "dotfiles"),
		model: { provider: "chatgpt-2", id: "gpt-5.6-sol", reasoning: true, contextWindow: 272000 },
		thinkingLevel: "high",
		getContextUsage: () => ({ tokens: 181696, percent: 66.8, contextWindow: 272000 }),
		sessionManager: { getEntries: () => [
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant", usage: { input: 1200000, output: 200000, cost: { total: 40 } } } },
			{ type: "message", message: { role: "assistant", usage: { input: 200000, output: 69000, cost: { total: 5.214 } } } },
		] },
	};
	const identity = (_color, text) => text;
	const labels = getFrameLabels(context, identity);
	assert.equal(labels.topRight, " gpt-5.6-sol · high");
	assert.equal(labels.bottomLeft, "182k/272k  $45.214");
	assert.equal(labels.bottomRight, "~/dotfiles");
	const editor = new FramedEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text },
		{ matches: () => false },
		{ paddingX: 3, embedWorkingStatus: true },
	);
	editor.getLabels = () => getFrameLabels(context, identity);
	editor.setWorkingStatusIndicator({ renderInBorder: () => "⠋ 1m 2s", renderSpinnerInBorder: () => "⠋" });
	editor.setText("next prompt");
	for (const width of [5, 12, 20, 32, 48, 80, 140]) {
		const lines = editor.render(width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), JSON.stringify({ width, lines }));
		if (width >= 32) assert.ok(lines[0].includes("⠋ 1m 2s"));
		if (width >= 48) {
			assert.ok(lines[0].includes(labels.topRight));
			assert.ok(lines.at(-1).endsWith(" ~/dotfiles ─╯"));
		}
		if (width >= 80) assert.ok(lines.at(-1).includes(labels.bottomLeft));
	}
	context.model.id = "long-model-name-汉字".repeat(10);
	assert.ok(editor.render(48).every((line) => visibleWidth(line) <= 48));
	context.model.id = "new-model";
	assert.ok(editor.render(80)[0].includes("new-model"));
	context.getContextUsage = () => ({ tokens: null, percent: null, contextWindow: 272000 });
	assert.equal(getFrameLabels(context, identity).bottomLeft, "?/272k  $45.214");
	context.getContextUsage = () => ({ tokens: 0, percent: 0, contextWindow: 272000 });
	assert.equal(getFrameLabels(context, identity).bottomLeft, "0/272k  $45.214");
	context.getContextUsage = () => ({ tokens: 187000, percent: 18.7, contextWindow: 1000000 });
	assert.equal(getFrameLabels(context, identity).bottomLeft, "187k/1.0M  $45.214");
});

test("footer renders no rows", async () => {
	const handlers = new Map();
	let factory;
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	await handlers.get("session_start")({}, { hasUI: true, mode: "tui", ui: { ...stubUI(), setFooter: (value) => { factory = value; } } });
	const footer = factory({}, { fg: (_color, text) => text }, { getExtensionStatuses: () => new Map([["pool", "chatgpt: work"]]) });
	for (const width of [12, 48, 140]) {
		const lines = footer.render(width);
		assert.deepEqual(lines, []);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
	}
});

test("working label shimmers without changing text width or animating the timer", () => {
	const theme = {
		colors: { muted: rgbColor(134, 134, 134), text: rgbColor(255, 255, 255) },
		fg: (_color, text) => text,
		style: (text, options) => styleText(text, options, "truecolor"),
	};
	const first = formatWorkingMessage(0, theme, true);
	const second = formatWorkingMessage(400, theme, true);
	assert.notEqual(first, second);
	assert.equal(stripVTControlCharacters(first), "Working... 0s");
	assert.equal(stripVTControlCharacters(second), "Working... 0s");
	assert.equal(visibleWidth(first), visibleWidth(second));
	assert.equal(stripVTControlCharacters(formatWorkingMessage(85000, theme, true)), "Working... 1m 25s");
	assert.equal(formatWorkingMessage(0, theme, false), "Working... 0s");
	assert.equal(formatWorkingMessage(400, theme, false), "Working... 0s");
});

test("shimmer colors keep the label text and differ from mono", () => {
	const theme = {
		colors: { accent: rgbColor(0, 128, 255), muted: rgbColor(134, 134, 134), text: rgbColor(255, 255, 255) },
		fg: (_color, text) => text,
		style: (text, options) => styleText(text, options, "truecolor"),
	};
	const mono = formatWorkingMessage(400, theme, true, "mono");
	for (const [shimmer, provider] of [["rainbow"], ["sunset"], ["ocean"], ["matrix"], ["ember"], ["sakura"], ["grape"], ["provider", "anthropic"], ["provider", "openai"]]) {
		const message = formatWorkingMessage(400, theme, true, shimmer, provider);
		assert.equal(stripVTControlCharacters(message), "Working... 0s");
		assert.notEqual(message, mono);
	}
	assert.notEqual(formatWorkingMessage(0, theme, true, "rainbow"), formatWorkingMessage(400, theme, true, "rainbow"));
});

test("elapsed timer survives continuation and stops on settle, shutdown, and restart", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 10000 });
	const handlers = new Map();
	const setWorkingMessage = t.mock.fn();
	const ui = {
		setEditorComponent() {},
		setStatus() {},
		setWorkingIndicator() {},
		setWorkingMessage,
		setFooter() {},
		theme: { fg: (_color, text) => text },
	};
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	ui.theme.colors = { muted: rgbColor(134, 134, 134), text: rgbColor(255, 255, 255) };
	ui.theme.style = (text) => text;
	const context = { hasUI: true, mode: "tui", ui };
	await handlers.get("session_start")({}, context);
	handlers.get("agent_start")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "Working... 0s");
	t.mock.timers.tick(3000);
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "Working... 3s");
	handlers.get("agent_start")();
	t.mock.timers.tick(58000);
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "Working... 1m 1s");
	handlers.get("agent_settled")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], undefined);
	const settledCalls = setWorkingMessage.mock.callCount();
	t.mock.timers.tick(5000);
	assert.equal(setWorkingMessage.mock.callCount(), settledCalls);
	handlers.get("agent_start")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "Working... 0s");
	await handlers.get("session_start")({}, context);
	const restartedCalls = setWorkingMessage.mock.callCount();
	t.mock.timers.tick(5000);
	assert.equal(setWorkingMessage.mock.callCount(), restartedCalls);
	handlers.get("agent_start")();
	await handlers.get("session_shutdown")();
	const stoppedCalls = setWorkingMessage.mock.callCount();
	t.mock.timers.tick(5000);
	assert.equal(setWorkingMessage.mock.callCount(), stoppedCalls);
	await handlers.get("session_start")({}, { ...context, mode: "rpc" });
	handlers.get("agent_start")();
	t.mock.timers.tick(5000);
	assert.equal(setWorkingMessage.mock.callCount(), stoppedCalls);
});

test("footer commands complete their options and mark the current one", async () => {
	const { completeOptions } = await jiti.import("../footer-cleanup.ts");
	assert.deepEqual(completeOptions(["mono", "matrix", "ocean"], "matrix", "m").map((item) => [item.value, item.description]), [["mono", undefined], ["matrix", "current"]]);
	assert.equal(completeOptions(["mono"], "mono", "x"), null);
});
