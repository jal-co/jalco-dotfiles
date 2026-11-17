import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const harness = fileURLToPath(new URL("./fixtures/review-harness.mjs", import.meta.url));
const command = "echo ap-fixture-guard";
const flags = ["--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-session"];

async function review(t: test.TestContext, reviewer: "approve" | "error" | "missing", reviewerApi?: string) {
  const home = mkdtempSync(join(tmpdir(), "pi-auto-permissions-test-"));
  t.after(() => rmSync(home, { recursive: true }));
  const config = join(home, "config.json");
  const calls = join(home, "calls.jsonl");
  writeFileSync(config, JSON.stringify({
    ui: { enabled: false },
    reviewer: { provider: "fixture-reviewer", model: "reviewer", reasoningEffort: "low", timeoutMs: 10_000 },
    rules: [{ pattern: "\\bap-fixture-guard\\b", level: "guarded", group: "fixture", label: "Fixture guard" }],
  }));
  const running = run("pi", [...flags, "-e", harness, "--model", "fixture-agent/agent", "--mode", "json", "-p", "run the fixture command twice"], {
    cwd: home,
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      PI_CODING_AGENT_DIR: join(home, "agent"),
      PI_OFFLINE: "1",
      PI_AUTO_PERMISSIONS_CONFIG: config,
      AP_TEST_REVIEWER: reviewer,
      ...(reviewerApi ? { AP_TEST_REVIEWER_API: reviewerApi } : {}),
      AP_TEST_COMMAND: command,
      AP_TEST_CALLS: calls,
    },
  });
  running.child.stdin?.end();
  const { stdout } = await running;
  const ends = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((event) => event.type === "tool_execution_end" && event.toolName === "bash");
  assert.equal(ends.length, 2, "both bash tool calls should finish");
  const reviewerCalls = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { results: ends.map((end) => ({ isError: end.isError as boolean, output: JSON.stringify(end.result) })), reviewerCalls };
}

test("an approve verdict from an extension-registered reviewer lets the command run", async (t) => {
  const { results, reviewerCalls } = await review(t, "approve");
  for (const result of results) {
    assert.equal(result.isError, false, result.output);
    assert.match(result.output, /ap-fixture-guard/);
  }
  assert.deepEqual(reviewerCalls, [
    { reasoning: "low", cacheRetention: "long", evidence: "full" },
    { reasoning: "low", cacheRetention: "long", evidence: "delta" },
  ]);
});

test("a claude-bridge reviewer gets one-off calls with full evidence every time", async (t) => {
  const { results, reviewerCalls } = await review(t, "approve", "claude-bridge");
  for (const result of results) assert.equal(result.isError, false, result.output);
  assert.deepEqual(reviewerCalls, [
    { reasoning: "low", cacheRetention: "none", evidence: "full" },
    { reasoning: "low", cacheRetention: "none", evidence: "full" },
  ]);
});

test("a reviewer error result blocks the command", async (t) => {
  const { results, reviewerCalls } = await review(t, "error");
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.match(result.output, /Fixture guard requires user approval: Automatic review failed: fixture reviewer outage/);
  }
  assert.equal(reviewerCalls.length, 2);
});

test("a missing reviewer provider blocks the command", async (t) => {
  const { results, reviewerCalls } = await review(t, "missing");
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.match(result.output, /Fixture guard requires user approval: Automatic review failed: review model not found: fixture-reviewer\/reviewer/);
  }
  assert.deepEqual(reviewerCalls, []);
});
