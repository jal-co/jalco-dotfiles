import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { interceptGitCommand } from "../git-interceptor.ts";

test("ignores non-git commands", () => {
	assert.equal(interceptGitCommand("printf gitignore"), undefined);
});

test("blocks no-verify", () => {
	assert.deepEqual(interceptGitCommand("git commit --no-verify -m test"), {
		block: true,
		reason: "Git --no-verify is blocked. Fix the hook failure instead of bypassing it.",
	});
});

test("forces git commands to remain non-interactive", () => {
	const result = interceptGitCommand("git rebase main");
	assert.ok(result && "command" in result);
	assert.match(result.command, /^export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no; git rebase main$/);
});

test("preserves shell loops containing git", () => {
	const result = interceptGitCommand('for item in one two; do git --version >/dev/null; printf "%s " "$item"; done');
	assert.ok(result && "command" in result);
	assert.equal(execFileSync("bash", ["-c", result.command], { encoding: "utf8" }), "one two ");
});

test("exports git editor settings across compound commands", () => {
	const result = interceptGitCommand('if git --version >/dev/null; then printf "%s/%s/%s" "$GIT_EDITOR" "$GIT_SEQUENCE_EDITOR" "$GIT_MERGE_AUTOEDIT"; fi');
	assert.ok(result && "command" in result);
	assert.equal(execFileSync("bash", ["-c", result.command], { encoding: "utf8" }), "true/true/no");
});
