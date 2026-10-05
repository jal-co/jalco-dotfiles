import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	evaluateGate,
	findingsOnChangedLines,
	hasUserSkip,
	isGatedCommand,
	LAUNCHER_PATH,
	launcherFor,
	parseChangedLines,
	selectSourceFiles,
	type Exec,
} from "./core.js";

const realExec: Exec = async (command, args) => {
	const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1 };
};

const git = (root: string, ...args: string[]) =>
	execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);

function makeRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "shadcn-lint-gate-")));
	git(root, "init", "-q");
	git(root, "commit", "-q", "--allow-empty", "-m", "root");
	mkdirSync(join(root, "app"));
	writeFileSync(join(root, "app", "components.json"), "{}\n");
	writeFileSync(join(root, "app", "bad.tsx"), "export const Bad = () => <div className=\"bg-red-500\" />;\n");
	git(root, "add", ".");
	git(root, "commit", "-q", "-m", "change");
	return root;
}

function makeMastraRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "mastra-ui-gate-")));
	git(root, "init", "-q");
	mkdirSync(join(root, "web", "src"), { recursive: true });
	writeFileSync(join(root, "web", "package.json"), JSON.stringify({ dependencies: { "@mastra/playground-ui": "59.0.0" } }));
	writeFileSync(join(root, "web", "src", "page.tsx"), "export const Old = () => <h1>Legacy</h1>;\n");
	git(root, "add", ".");
	git(root, "commit", "-q", "-m", "root");
	return root;
}

test("gated command detection", () => {
	assert.ok(isGatedCommand("gh pr create --title x"));
	assert.ok(isGatedCommand("git -C /repo push"));
	assert.ok(isGatedCommand("git commit -m 'x'"));
	assert.ok(!isGatedCommand("git status"));
	assert.ok(hasUserSkip("SHADCN_LINT_SKIP=1 git push"));
});

test("launcher selection prefers the Mastra rules for playground-ui packages", () => {
	const root = mkdtempSync(join(tmpdir(), "shadcn-lint-select-"));
	for (const dir of ["app", "other", "web/src"]) mkdirSync(join(root, dir), { recursive: true });
	writeFileSync(join(root, "app", "components.json"), "{}\n");
	writeFileSync(join(root, "web", "package.json"), JSON.stringify({ dependencies: { "@mastra/playground-ui": "1.0.0" } }));
	for (const file of ["app/a.tsx", "other/b.tsx", "web/src/c.tsx", "web/src/c.test.tsx"]) writeFileSync(join(root, file), "");
	assert.equal(launcherFor(root, join(root, "app", "a.tsx")), "shadcn");
	assert.equal(launcherFor(root, join(root, "web", "src", "c.tsx")), "mastra");
	const selected = selectSourceFiles(root, "app/a.tsx\nother/b.tsx\nweb/src/c.tsx\nweb/src/c.test.tsx\n");
	assert.deepEqual(selected.get("shadcn"), [join(root, "app", "a.tsx")]);
	assert.deepEqual(selected.get("mastra"), [join(root, "web", "src", "c.tsx")]);
});

test("changed lines come from zero-context hunks", () => {
	const changed = parseChangedLines("/r", "+++ b/a.tsx\n@@ -1,0 +2,2 @@\n+x\n+y\n@@ -9 +10 @@\n-z\n+w\n");
	assert.deepEqual([...(changed.get("/r/a.tsx") ?? [])], [2, 3, 10]);
	const kept = findingsOnChangedLines(
		[
			{ file: "/r/a.tsx", line: 3, code: "c", message: "m" },
			{ file: "/r/a.tsx", line: 7, code: "c", message: "m" },
		],
		changed,
	);
	assert.deepEqual(kept.map((finding) => finding.line), [3]);
});

test("evaluateGate blocks only on findings in changed lines", async () => {
	const root = makeRepo();
	const exec: Exec = async (command, args) => {
		if (command === LAUNCHER_PATH) {
			const report = { diagnostics: [{ code: "shadcn(no-raw-colors)", message: "raw", filename: join(root, "app", "bad.tsx"), labels: [{ span: { line: 1 } }] }] };
			return { stdout: JSON.stringify(report), stderr: "", code: 1 };
		}
		return realExec(command, args);
	};
	const reason = await evaluateGate(exec, root, "git push");
	assert.ok(reason?.includes("app/bad.tsx:1 shadcn(no-raw-colors)"));
	assert.ok(reason?.includes("SHADCN_LINT_SKIP=1"));
	assert.equal(await evaluateGate(exec, root, "SHADCN_LINT_SKIP=1 git push"), undefined);
});

test("commit gate runs the Mastra rules on staged lines only", async () => {
	const root = makeMastraRepo();
	writeFileSync(join(root, "web", "src", "page.tsx"), "export const Old = () => <h1>Legacy</h1>;\nexport const New = () => <p>Loading...</p>;\n");
	git(root, "add", ".");
	const reason = await evaluateGate(realExec, root, "git commit -m x");
	assert.ok(reason?.includes("web/src/page.tsx:2 mastra-ui(no-three-dot-ellipsis)"));
	assert.ok(!reason?.includes("no-raw-h1"));
});
