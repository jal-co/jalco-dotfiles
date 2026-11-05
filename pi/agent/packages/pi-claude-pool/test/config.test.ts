import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { accountEnv, createOpReader, readSources, resolveAccounts } from "../config.ts";

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-claude-config-test-"));
  t.after(() => rmSync(dir, { recursive: true }));
  return join(dir, "config.json");
}

test("resolves named environment references without modifying the environment", async (t) => {
  const path = fixture(t);
  writeFileSync(path, JSON.stringify({ accounts: [{ id: "one", tokenEnv: "CLAUDE_POOL_ONE" }] }));
  const env = { CLAUDE_POOL_ONE: "test-token-one" };
  assert.deepEqual(await resolveAccounts(readSources(path), env), [{ id: "one", token: "test-token-one" }]);
  assert.deepEqual(env, { CLAUDE_POOL_ONE: "test-token-one" });
});

test("reads owner-only token files on macOS and Linux", async (t) => {
  const path = fixture(t);
  const tokenFile = join(path, "..", "token");
  writeFileSync(tokenFile, "test-token-one\n", { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ accounts: [{ id: "one", tokenFile }] }));
  assert.equal((await resolveAccounts(readSources(path)))[0].token, "test-token-one");
});

test("rejects readable-by-others token files without echoing their contents", async (t) => {
  const path = fixture(t);
  writeFileSync(path, "private-test-token", { mode: 0o644 });
  await assert.rejects(() => resolveAccounts([{ id: "one", tokenFile: path }]), /private token file/);
});

for (const value of [
  { accounts: [] },
  { accounts: [{ id: "one", token: "do-not-log-this" }] },
  { accounts: [{ id: "one", tokenEnv: "HOME" }] },
  { accounts: [{ id: "one", tokenFile: "relative" }] },
  { accounts: [{ id: "one", tokenEnv: "CLAUDE_POOL_ONE", tokenFile: "/tmp/token" }] },
  { accounts: [{ id: "../one", tokenEnv: "CLAUDE_POOL_ONE" }] },
  { accounts: [{ id: "one", tokenEnv: "CLAUDE_POOL_ONE" }, { id: "one", tokenEnv: "CLAUDE_POOL_TWO" }] },
]) {
  test(`rejects invalid config ${JSON.stringify(value)}`, (t) => {
    const path = fixture(t);
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => readSources(path), (error: Error) => !error.message.includes("do-not-log-this"));
  });
}

test("does not expose malformed JSON or missing token values", async (t) => {
  const path = fixture(t);
  writeFileSync(path, '{"token":"secret-test-value"');
  assert.throws(() => readSources(path), (error: Error) => !error.message.includes("secret-test-value"));
  await assert.rejects(() => resolveAccounts([{ id: "one", tokenEnv: "CLAUDE_POOL_ONE" }], {}), /Missing/);
});

test("rejects duplicate tokens", async () => {
  await assert.rejects(() => resolveAccounts([
    { id: "one", tokenEnv: "CLAUDE_POOL_ONE" }, { id: "two", tokenEnv: "CLAUDE_POOL_TWO" },
  ], { CLAUDE_POOL_ONE: "same-test-token", CLAUDE_POOL_TWO: "same-test-token" }), /same token/);
});

test("child receives only selected auth and keeps unrelated environment overrides", () => {
  const parent = { CLAUDE_POOL_ONE: "first", CLAUDE_POOL_TWO: "second", ANTHROPIC_API_KEY: "paid-key", HTTPS_PROXY: "proxy" };
  const override = { CLAUDE_CODE_OAUTH_TOKEN: "wrong", ANTHROPIC_BASE_URL: "wrong-host", CLAUDE_POOL_THREE: "third", HTTPS_PROXY: "private-proxy" };
  const env = accountEnv({ id: "one", token: "first" }, override, parent);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "first");
  for (const name of ["CLAUDE_POOL_ONE", "CLAUDE_POOL_TWO", "CLAUDE_POOL_THREE", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) assert.equal(env[name], "");
  assert.equal(env.HTTPS_PROXY, "private-proxy");
  assert.equal(override.CLAUDE_CODE_OAUTH_TOKEN, "wrong");
  assert.equal(parent.CLAUDE_POOL_TWO, "second");
});

test("resolves 1Password references without persisting secret values", async (t) => {
  const path = fixture(t);
  const tokenRef = "op://vault/Claude Sub 1/credential";
  writeFileSync(path, JSON.stringify({ accounts: [{ id: "one", tokenRef }] }));
  const result = await resolveAccounts(readSources(path), {}, async (reference) => {
    assert.equal(reference, tokenRef);
    return "first-op-test-token\n";
  });
  assert.deepEqual(result, [{ id: "one", token: "first-op-test-token" }]);
});

test("1Password reads are shared between requests and failed reads are not cached", async () => {
  let calls = 0;
  const read = createOpReader(async () => {
    calls++;
    if (calls === 1) throw new Error("op failed: do-not-log-test-secret");
    return "op-test-token";
  });
  const source = [{ id: "one", tokenRef: "op://vault/item/credential" }];
  await assert.rejects(resolveAccounts(source, {}, read), (error: Error) => {
    assert.match(error.message, /1Password token for one/);
    assert.doesNotMatch(error.message, /do-not-log-test-secret/);
    return true;
  });
  const resolved = await Promise.all([resolveAccounts(source, {}, read), resolveAccounts(source, {}, read)]);
  assert.equal(calls, 2);
  assert.equal(resolved[0][0].token, "op-test-token");
  assert.deepEqual(resolved[0], resolved[1]);
});

test("rejects ambiguous and malformed 1Password references", (t) => {
  const path = fixture(t);
  for (const entry of [
    { id: "one", tokenRef: "https://example.com" },
    { id: "one", tokenRef: "op://vault" },
    { id: "one", tokenRef: "op://vault/item/credential\n" },
    { id: "one", tokenRef: "op://vault/item/credential", tokenEnv: "CLAUDE_POOL_ONE" },
  ]) {
    writeFileSync(path, JSON.stringify({ accounts: [entry] }));
    assert.throws(() => readSources(path), /reference|op:\/\//);
  }
});
