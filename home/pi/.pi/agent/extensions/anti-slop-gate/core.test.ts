import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateGate, hasUserSkip, isGatedCommand, selectSourceFiles, type Exec } from "./core.js";

const realExec: Exec = async (command, args) => {
	try {
		const stdout = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { stdout, stderr: "", code: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; status?: number };
		return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.status ?? 1 };
	}
};

function makeRepo(fileName: string, contents: string): string {
	const root = mkdtempSync(join(tmpdir(), "anti-slop-gate-"));
	execFileSync("git", ["-C", root, "init", "-q"]);
	execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root"]);
	writeFileSync(join(root, fileName), contents);
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change"]);
	return root;
}

test("gated command detection", () => {
	assert.ok(isGatedCommand("gh pr create --title x"));
	assert.ok(isGatedCommand("cd /tmp && git push -u origin main"));
	assert.ok(isGatedCommand("git -C /repo push"));
	assert.ok(isGatedCommand("gh pr edit 12 --body-file=-"));
	assert.ok(!isGatedCommand("git status && gh pr view"));
	assert.ok(!isGatedCommand("echo push it || gh pr checkout 3"));
	assert.ok(hasUserSkip("ANTI_SLOP_SKIP=1 git push"));
});

test("source file selection filters languages and missing paths", () => {
	const root = mkdtempSync(join(tmpdir(), "anti-slop-select-"));
	writeFileSync(join(root, "a.ts"), "");
	writeFileSync(join(root, "b.md"), "");
	const picked = selectSourceFiles(root, "a.ts\nb.md\nmissing.tsx\n");
	assert.deepEqual(picked, [join(root, "a.ts")]);
});

test("evaluateGate blocks committed slop and passes clean code", async () => {
	const bad = makeRepo("bad.ts", "export function f(input: unknown): unknown {\n\treturn input as any as string;\n}\n");
	const badReason = await evaluateGate(realExec, bad, "git push -u origin main");
	assert.ok(badReason && badReason.includes("anti-slop"));
	assert.ok(badReason.includes("ANTI_SLOP_SKIP=1"));

	const clean = makeRepo("clean.ts", "export const answer: number = 42;\n");
	assert.equal(await evaluateGate(realExec, clean, "gh pr create --fill"), undefined);
});

test("evaluateGate stays out of the way", async () => {
	const bad = makeRepo("bad.ts", "export function f(input: unknown): unknown {\n\treturn input;\n}\n");
	assert.equal(await evaluateGate(realExec, bad, "git status"), undefined);
	assert.equal(await evaluateGate(realExec, bad, "ANTI_SLOP_SKIP=1 git push"), undefined);
	assert.equal(await evaluateGate(realExec, tmpdir(), "git push"), undefined);
});
