import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const run = promisify(execFile);

function fixture(t: test.TestContext) {
  const home = mkdtempSync(join(tmpdir(), "pi-pool-bridge-test-"));
  t.after(() => rmSync(home, { recursive: true }));
  const agentDir = join(home, "agent");
  mkdirSync(agentDir);
  return { home, agentDir, env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: agentDir, CLAUDE_CONFIG_DIR: join(home, "claude"), PI_OFFLINE: "1" } };
}

const flags = ["--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates"];

test("actual Pi loads one pooled provider without touching credentials", async (t) => {
  const { home, env } = fixture(t);
  const result = await run("pi", [...flags, "-e", fileURLToPath(new URL("../index.ts", import.meta.url)), "--list-models"], { env, cwd: home, timeout: 30_000 });
  assert.match(result.stdout, /claude-bridge\s+claude-/);
  assert.match(result.stdout, /claude-bridge\s+claude-fable-5-2\s+1M/);
  assert.doesNotMatch(result.stderr, /error|failed/i);
});

test("actual bridge forwards the selected token to the SDK and fails over", async (t) => {
  const { home, agentDir, env } = fixture(t);
  writeFileSync(join(agentDir, "claude-pool.json"), JSON.stringify({ accounts: [
    { id: "one", tokenEnv: "CLAUDE_POOL_ONE" }, { id: "two", tokenEnv: "CLAUDE_POOL_TWO" },
  ] }));
  writeFileSync(join(agentDir, "claude-bridge.json"), JSON.stringify({ provider: { plan: "pro" }, startupNoticeShown: "test" }));
  const capture = join(home, "capture.json");
  const running = run("pi", [...flags, "-e", fileURLToPath(new URL("./fixtures/bridge-smoke.mjs", import.meta.url)), "--no-session", "--model", "claude-bridge/claude-sonnet-5-5", "--print", "smoke test"], {
    cwd: home, timeout: 30_000,
    env: { ...env, CLAUDE_POOL_ONE: "first-smoke-token", CLAUDE_POOL_TWO: "second-smoke-token", ANTHROPIC_API_KEY: "must-not-reach-sdk", POOL_TEST_CAPTURE: capture },
  });
  running.child.stdin?.end();
  const result = await running;
  assert.match(result.stdout, /pool smoke passed/);
  assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")).attempts, ["one", "two"]);
  assert.doesNotMatch(result.stdout + result.stderr, /first-smoke-token|second-smoke-token|must-not-reach-sdk/);
});
