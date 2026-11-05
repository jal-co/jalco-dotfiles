import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const PEM_HEADER = ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ");
import { findSecrets, newestSession, sessionDirectory, sessionId } from "../src/session.mjs";

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "boat-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("maps a working directory to Pi's session folder", () => {
  assert.equal(sessionDirectory("/Users/justin/dotfiles", "/a"), "/a/sessions/--Users-justin-dotfiles--");
});

test("picks the most recently modified session", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "old_1.jsonl"), "{}");
  writeFileSync(join(root, "new_2.jsonl"), "{}");
  writeFileSync(join(root, "ignore.txt"), "x");
  utimesSync(join(root, "old_1.jsonl"), 1, 1);
  assert.equal(newestSession(root), join(root, "new_2.jsonl"));
  const empty = join(root, "empty");
  mkdirSync(empty);
  assert.throws(() => newestSession(empty), /No Pi sessions/);
});

test("flags credential-shaped text before anything is copied", (t) => {
  const root = directory(t);
  const clean = join(root, "clean.jsonl");
  writeFileSync(clean, '{"text":"nothing secret, op://vault/item/credential is only a reference"}');
  assert.deepEqual(findSecrets(clean), []);
  for (const secret of [`sk-ant-${"a".repeat(30)}`, `ops_${"b".repeat(30)}`, `ghp_${"c".repeat(30)}`, `tskey-auth-${"d".repeat(20)}`, `${PEM_HEADER}\\n${"A".repeat(60)}`]) {
    const dirty = join(root, "dirty.jsonl");
    writeFileSync(dirty, `{"text":"${secret}"}`);
    assert.equal(findSecrets(dirty).length, 1, secret.slice(0, 8));
  }
});

test("the words of a private key header alone are not treated as a key", (t) => {
  const root = directory(t);
  const mention = join(root, "mention.jsonl");
  writeFileSync(mention, `{"text":"a test string: ${PEM_HEADER}"}`);
  assert.deepEqual(findSecrets(mention), []);
});

test("derives a short stable id from the session filename", () => {
  assert.equal(sessionId("/s/2026-11-05T01-01-43-670Z_01a1a939-db75-73c7-9044-6a861783c377.jsonl"), "01a1a939");
  assert.equal(sessionId("/s/odd.jsonl"), "fork");
});
