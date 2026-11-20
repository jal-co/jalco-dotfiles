import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const RUNNER = join(import.meta.dirname, "..", "chart", "runner.mjs");

function run(code: string, data?: { names: string[]; values: number[] }) {
	const path = join(mkdtempSync(join(tmpdir(), "chart-test-")), "out.png");
	const result = spawnSync(process.execPath, [RUNNER], { input: JSON.stringify({ code, data, scale: 1, path }), encoding: "utf8" });
	return { ...result, path };
}

test("the runner writes a PNG from code that returns a figure, in a theme that needs Inter", () => {
	const result = run('const [fig, ax] = mpl.subplots({ style: "pro-dark" }); ax.bar(data.names, data.values); return fig;', { names: ["a", "b"], values: [1, 2] });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(result.path).subarray(1, 4).toString(), "PNG");
});

test("code that returns no figure fails with a message that says what to return", () => {
	const result = run("mpl.subplots();");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /must return the Figure/);
});

test("an unknown keyword fails, as in matplotlib", () => {
	const result = run("const [fig, ax] = mpl.subplots(); ax.plot([1, 2], [1, 2], { colour: 'red' }); return fig;");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /colour/);
});
