import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTurnRecorder, MISS_WRITE_TOKENS, pruneTraceRuns, type TurnRecord } from "../turn-log.ts";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pool-turns-"));
  const before = process.env.CLAUDE_BRIDGE_TRACE_DIR;
  const beforeMax = process.env.CLAUDE_BRIDGE_TRACE_MAX_RUN_BYTES;
  delete process.env.CLAUDE_BRIDGE_TRACE_DIR;
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    if (before === undefined) delete process.env.CLAUDE_BRIDGE_TRACE_DIR; else process.env.CLAUDE_BRIDGE_TRACE_DIR = before;
    if (beforeMax === undefined) delete process.env.CLAUDE_BRIDGE_TRACE_MAX_RUN_BYTES; else process.env.CLAUDE_BRIDGE_TRACE_MAX_RUN_BYTES = beforeMax;
  });
  return { log: join(root, "state", "turns.jsonl"), trace: join(root, "state", "trace"), root };
}

const turn = (session: string, cacheRead: number, cacheWrite: number): TurnRecord => ({
  at: "2026-11-05T00:00:00.000Z", session, account: "one", model: "claude-sonnet-5-5", reasoning: "medium", continuation: true,
  messages: 4, input: 2, cacheRead, cacheWrite, output: 10, stopReason: "toolUse",
});

const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("records every turn with its index and never marks a session's first turn as a miss", (t) => {
  const { log, trace } = fixture(t);
  const record = createTurnRecorder(log, trace);
  record(turn("s", 0, 30_000));
  record(turn("s", 30_000, 120));
  assert.deepEqual(rows(log).map((row) => [row.turn, row.miss]), [[0, false], [1, false]]);
  assert.equal(process.env.CLAUDE_BRIDGE_TRACE_DIR, undefined);
});

test("a large write after the first turn is a miss and switches the bridge trace on", (t) => {
  const { log, trace } = fixture(t);
  const record = createTurnRecorder(log, trace);
  record(turn("s", 0, 30_000));
  record(turn("s", 30_000, MISS_WRITE_TOKENS));
  assert.equal(rows(log)[1].miss, true);
  assert.equal(process.env.CLAUDE_BRIDGE_TRACE_DIR, trace);
  assert.equal(process.env.CLAUDE_BRIDGE_TRACE_MAX_RUN_BYTES, String(64 * 1024 * 1024));
});

test("sessions are counted separately", (t) => {
  const { log, trace } = fixture(t);
  const record = createTurnRecorder(log, trace);
  record(turn("a", 0, 30_000));
  record(turn("b", 0, 30_000));
  assert.deepEqual(rows(log).map((row) => row.miss), [false, false]);
});

test("a log that cannot be written never throws into the request", (t) => {
  const { root, trace } = fixture(t);
  const blocked = join(root, "file");
  writeFileSync(blocked, "x");
  const record = createTurnRecorder(join(blocked, "turns.jsonl"), trace);
  assert.doesNotThrow(() => record(turn("s", 0, 1)));
});

test("old trace runs are pruned and recent ones and other files are kept", (t) => {
  const { trace } = fixture(t);
  mkdirSync(join(trace, "run-old"), { recursive: true });
  mkdirSync(join(trace, "run-new"), { recursive: true });
  writeFileSync(join(trace, "keep.txt"), "x");
  const old = (Date.now() - 4 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(join(trace, "run-old"), old, old);
  assert.equal(pruneTraceRuns(trace), 1);
  assert.equal(pruneTraceRuns(join(trace, "missing")), 0);
  assert.equal(readFileSync(join(trace, "keep.txt"), "utf8"), "x");
});
