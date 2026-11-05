import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { AccountPool } from "../pool.ts";

const accounts = [{ id: "one", token: "test-one-secret" }, { id: "two", token: "test-two-secret" }];

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-claude-pool-test-"));
  t.after(() => rmSync(dir, { recursive: true }));
  return new AccountPool(join(dir, "state.sqlite"));
}

test("round robins new sessions and preserves affinity across process restarts", (t) => {
  const pool = fixture(t);
  assert.equal(pool.select(accounts, "first", new Set()).id, "one");
  assert.equal(pool.select(accounts, "second", new Set()).id, "two");
  assert.equal(pool.select(accounts, "third", new Set()).id, "one");
  const reopened = new AccountPool(pool.path);
  assert.equal(reopened.select(accounts, "second", new Set()).id, "two");
});

test("quota cooldown skips an account until its provider reset", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "first", new Set(), 1000);
  pool.block(accounts[0], "quota", 10_000);
  assert.equal(pool.select(accounts, "first", new Set(), 2000).id, "two");
  assert.equal(pool.select(accounts, "new", new Set(), 10_001).id, "one");
});

test("exhaustion reports reset times without credentials", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "first", new Set(), 1000);
  pool.block(accounts[0], "quota", 10_000);
  pool.block(accounts[1], "auth", Number.MAX_SAFE_INTEGER);
  assert.throws(() => pool.select(accounts, "second", new Set(), 2000), (error: Error) => {
    assert.match(error.message, /one: quota resets/);
    assert.match(error.message, /two: replace expired or rejected token/);
    return true;
  });
  for (const account of accounts) assert.equal(readFileSync(pool.path).includes(Buffer.from(account.token)), false);
});

test("rotating an invalid token re-enables that account", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "first", new Set());
  pool.block(accounts[0], "auth", Number.MAX_SAFE_INTEGER);
  const replacement = [{ id: "one", token: "new-test-token" }, accounts[1]];
  assert.equal(pool.select(replacement, "first", new Set()).id, "one");
  pool.block(accounts[0], "auth", Number.MAX_SAFE_INTEGER);
  assert.equal(pool.select(replacement, "first", new Set()).id, "one");
});

test("removing an account or exhausting the attempted set cannot reuse it", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "first", new Set());
  assert.equal(pool.select([accounts[1]], "first", new Set()).id, "two");
  assert.throws(() => pool.select(accounts, "first", new Set(["one", "two"])), /unavailable/);
});

test("simultaneous Pi processes assign sessions atomically", async (t) => {
  const pool = fixture(t);
  const moduleUrl = new URL("../pool.ts", import.meta.url).href;
  const run = promisify(execFile);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => run(process.execPath, [
    "--input-type=module", "-e",
    `import {AccountPool} from ${JSON.stringify(moduleUrl)}; const pool = new AccountPool(process.argv[1]); console.log(pool.select(${JSON.stringify(accounts)}, process.argv[2], new Set()).id);`,
    pool.path, `session-${index}`,
  ])));
  assert.equal(results.filter((result) => result.stdout.trim() === "one").length, 4);
  assert.equal(results.filter((result) => result.stdout.trim() === "two").length, 4);
});

test("late shorter cooldowns do not overwrite a rejected credential", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "first", new Set());
  pool.block(accounts[0], "auth", Number.MAX_SAFE_INTEGER);
  pool.block(accounts[0], "quota", Date.now() + 60_000);
  assert.throws(() => pool.select([accounts[0]], "new", new Set()), /one: replace expired or rejected token/);
});

test("a session stays on its account across many requests while other sessions come and go", (t) => {
  const pool = fixture(t);
  const home = pool.select(accounts, "long-running", new Set(), 1000).id;
  for (let request = 0; request < 60; request++) {
    pool.select(accounts, `other-${request}`, new Set(), 1000 + request);
    assert.equal(pool.select(accounts, "long-running", new Set(), 2000 + request).id, home);
  }
});

test("after a quota failover the session stays on the new account when the old one resets", (t) => {
  const pool = fixture(t);
  const first = pool.select(accounts, "s", new Set(), 1000);
  pool.block(first, "quota", 5000);
  const second = pool.select(accounts, "s", new Set(), 2000);
  assert.notEqual(second.id, first.id);
  for (const now of [6000, 7000, 8000]) assert.equal(pool.select(accounts, "s", new Set(), now).id, second.id);
});

test("selecting for an existing session does not count as a new assignment", (t) => {
  const pool = fixture(t);
  pool.select(accounts, "s", new Set(), 1000);
  const before = new DatabaseSync(pool.path).prepare("SELECT SUM(assigned) AS total FROM accounts").get()?.total;
  for (let request = 0; request < 20; request++) pool.select(accounts, "s", new Set(), 2000 + request);
  const after = new DatabaseSync(pool.path).prepare("SELECT SUM(assigned) AS total FROM accounts").get()?.total;
  assert.equal(after, before);
});
