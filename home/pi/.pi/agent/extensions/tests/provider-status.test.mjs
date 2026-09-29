import assert from "node:assert/strict";
import { createRequire, findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = require("jiti");
const runtimeEntry = pathToFileURL(realpathSync(join(dirname(process.execPath), "pi")));
const jiti = createJiti(import.meta.url, {
	alias: Object.fromEntries(["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].map((name) => [
		name, join(dirname(findPackageJSON(name, runtimeEntry)), "dist/index.js"),
	])),
});
const { default: providerStatus } = await jiti.import("../provider-status.ts");
const { default: footerCleanup, FramedEditor } = await jiti.import("../footer-cleanup.ts");
const { visibleWidth, CURSOR_MARKER } = await jiti.import("@earendil-works/pi-tui");

test("custom footer leaves the native working indicator visible", async (t) => {
	const handlers = new Map();
	const setFooter = t.mock.fn();
	const setWorkingVisible = t.mock.fn();
	providerStatus({ on: (name, handler) => handlers.set(name, handler) });
	await handlers.get("session_start")({}, { hasUI: true, ui: { setFooter, setWorkingVisible } });
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
		theme: { fg: (_color, text) => text },
	};
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	await handlers.get("session_start")({}, { hasUI: true, mode: "tui", ui });
	const factory = setEditorComponent.mock.calls[0].arguments[0];
	const editor = factory({ terminal: { rows: 40 }, requestRender() {} }, { borderColor: (text) => text }, { matches: () => false });
	assert.equal(editor.embedWorkingStatus, true);
	editor.setWorkingStatusIndicator({ renderInBorder: () => "⠋ 2s", renderSpinnerInBorder: () => "⠋" });
	editor.setText("my next prompt");
	assert.equal(editor.getText(), "my next prompt");
	const lines = editor.render(48);
	assert.ok(lines[0].startsWith("╭") && lines[0].includes("⠋ 2s"));
	assert.equal(lines.length, 4);
	assert.equal(lines[2], "│" + " ".repeat(46) + "│");
	await handlers.get("session_shutdown")();
});

test("wrapped input preserves column widths, cursor, and mouse coordinates", () => {
	const editor = new FramedEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text },
		{ matches: () => false },
		{ paddingX: 2, embedWorkingStatus: true },
	);
	editor.setPaddingX(0);
	assert.equal(editor.getPaddingX(), 2);
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
	editor.handleMouse({ type: "click", button: "left", x: 3, y: 1, width: 80, height: 3 });
	assert.equal(editor.getCursor().col, 1);
});

test("autocomplete stays below the frame and retains keyboard selection", async (t) => {
	const identity = (text) => text;
	const editor = new FramedEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } },
		{ matches: () => false },
		{ paddingX: 2, embedWorkingStatus: true },
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

test("elapsed timer survives continuation and stops on settle, shutdown, and restart", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 10000 });
	const handlers = new Map();
	const setWorkingMessage = t.mock.fn();
	const ui = {
		setEditorComponent() {},
		setStatus() {},
		setWorkingIndicator() {},
		setWorkingMessage,
		theme: { fg: (_color, text) => text },
	};
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	const context = { hasUI: true, mode: "tui", ui };
	await handlers.get("session_start")({}, context);
	handlers.get("agent_start")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "0s");
	t.mock.timers.tick(3000);
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "3s");
	handlers.get("agent_start")();
	t.mock.timers.tick(58000);
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "1m 1s");
	handlers.get("agent_settled")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], undefined);
	const settledCalls = setWorkingMessage.mock.callCount();
	t.mock.timers.tick(5000);
	assert.equal(setWorkingMessage.mock.callCount(), settledCalls);
	handlers.get("agent_start")();
	assert.equal(setWorkingMessage.mock.calls.at(-1).arguments[0], "0s");
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
