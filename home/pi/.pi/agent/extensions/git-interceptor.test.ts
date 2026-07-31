import assert from "node:assert/strict";
import test from "node:test";
import { interceptGitCommand } from "./git-interceptor.ts";

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
	assert.match(result.command, /^GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no git rebase main$/);
});
