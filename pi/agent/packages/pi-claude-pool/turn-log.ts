import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TurnRecord {
  at: string;
  session: string;
  account: string;
  model: string;
  reasoning: string | null;
  continuation: boolean;
  messages: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  stopReason: string;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const TRACE_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
export const MISS_WRITE_TOKENS = 10_000;

export function pruneTraceRuns(directory: string, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith("run-")) continue;
    const path = join(directory, name);
    try {
      if (now - statSync(path).mtimeMs > TRACE_KEEP_MS) {
        rmSync(path, { recursive: true, force: true });
        removed++;
      }
    } catch {
      continue;
    }
  }
  return removed;
}

export function createTurnRecorder(logPath: string, traceDirectory: string): (record: TurnRecord) => void {
  const turns = new Map<string, number>();
  pruneTraceRuns(traceDirectory);
  return (record) => {
    const index = turns.get(record.session) ?? 0;
    turns.set(record.session, index + 1);
    const miss = index > 0 && record.cacheWrite >= MISS_WRITE_TOKENS;
    if (miss && process.env.CLAUDE_BRIDGE_TRACE_DIR === undefined) {
      process.env.CLAUDE_BRIDGE_TRACE_DIR = traceDirectory;
      process.env.CLAUDE_BRIDGE_TRACE_MAX_RUN_BYTES = String(MAX_TRACE_BYTES);
    }
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) renameSync(logPath, `${logPath}.1`);
      appendFileSync(logPath, `${JSON.stringify({ ...record, turn: index, miss })}\n`, { mode: 0o600 });
    } catch {
      return;
    }
  };
}
