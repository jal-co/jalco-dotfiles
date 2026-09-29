import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = require("jiti");
const { default: providerStatus } = await createJiti(import.meta.url).import("../provider-status.ts");

test("custom footer leaves the native working indicator visible", async (t) => {
	const handlers = new Map();
	const setFooter = t.mock.fn();
	const setWorkingVisible = t.mock.fn();
	providerStatus({ on: (name, handler) => handlers.set(name, handler) });
	await handlers.get("session_start")({}, { hasUI: true, ui: { setFooter, setWorkingVisible } });
	assert.equal(setFooter.mock.callCount(), 1);
	assert.equal(setWorkingVisible.mock.callCount(), 0);
});
