import assert from "node:assert/strict";
import test from "node:test";
import { parseGithubRemote, safeRelativePath, validateBranch } from "../src/repo.mjs";
import { hostLabel, offloadKey } from "../src/state.mjs";

test("parses GitHub remotes in every common form", () => {
  for (const url of ["https://github.com/jal-co/dotfiles.git", "git@github.com:jal-co/dotfiles.git", "ssh://git@github.com/jal-co/dotfiles", "https://github.com/jal-co/dotfiles/"]) {
    assert.deepEqual(parseGithubRemote(url), { owner: "jal-co", repo: "dotfiles" });
  }
});

test("rejects remotes that are not plain GitHub repositories", () => {
  for (const url of ["https://gitlab.com/a/b.git", "https://github.com/a/b;rm -rf", "https://github.com/a/b/c", "file:///tmp/x", "https://github.com/$(id)/b"]) {
    assert.throws(() => parseGithubRemote(url), /GitHub/);
  }
});

test("rejects branch names that could alter a remote shell command", () => {
  for (const branch of ["a;b", "$(id)", "-x", "a..b", "a b", "a'b", ""]) assert.throws(() => validateBranch(branch));
  assert.equal(validateBranch("feat/new-thing_1.2"), "feat/new-thing_1.2");
});

test("keeps relative paths inside the repository", () => {
  assert.equal(safeRelativePath("/r", "a/b.txt"), "a/b.txt");
  assert.throws(() => safeRelativePath("/r", "../x"), /outside/);
  assert.throws(() => safeRelativePath("/r", "/etc/passwd"), /outside/);
});

test("host labels and keys are stable and shell safe", () => {
  assert.equal(hostLabel({ repo: "Platform", branch: "feat/Cool Thing" }), "boat-platform-feat-cool-thing");
  assert.ok(hostLabel({ repo: "r", branch: "x".repeat(200) }).length <= 48);
  assert.equal(offloadKey({ owner: "o", repo: "r", branch: "b" }), "o/r#b");
});
