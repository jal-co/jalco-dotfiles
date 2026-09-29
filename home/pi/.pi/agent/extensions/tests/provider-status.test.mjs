import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url);
const { default: providerStatus } = await jiti.import("../provider-status.ts");
const { default: footerCleanup } = await jiti.import("../footer-cleanup.ts");

test("custom footer leaves the native working indicator visible", async (t) => {
	const handlers = new Map();
	const setFooter = t.mock.fn();
	const setWorkingVisible = t.mock.fn();
	providerStatus({ on: (name, handler) => handlers.set(name, handler) });
	await handlers.get("session_start")({}, { hasUI: true, ui: { setFooter, setWorkingVisible } });
	assert.equal(setFooter.mock.callCount(), 1);
	assert.equal(setWorkingVisible.mock.callCount(), 0);
});

test("working status stays above the input rather than inside its border", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map();
	const setEditorComponent = t.mock.fn();
	const ui = {
		setEditorComponent,
		setStatus() {},
		setWorkingIndicator() {},
		theme: { fg: (_color, text) => text },
	};
	footerCleanup({ on: (name, handler) => handlers.set(name, handler), registerCommand() {} });
	await handlers.get("session_start")({}, { hasUI: true, ui });
	const factory = setEditorComponent.mock.calls[0].arguments[0];
	const editor = factory({ requestRender() {} }, { borderColor: (text) => text }, { matches: () => false });
	assert.notEqual(editor.embedWorkingStatus, true);
	editor.setText("my next prompt");
	assert.equal(editor.getText(), "my next prompt");
	await handlers.get("session_shutdown")();
});
