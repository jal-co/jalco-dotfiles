import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const taskRoot = () => process.env.REX_TASK_ROOT ?? join(homedir(), '.rex', 'tasks');
export const cleanText = (value) => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();

export function processBirth(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0, 'Invalid process PID');
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null;
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

export function writeAgentIdentity(value) {
  assert.equal(value.version, 1);
  assert.ok(value.id && value.surface && isAbsolute(value.sessionFile));
  assert.ok(value.birth && Number.isInteger(value.pid) && value.pid > 0);
  const file = `${value.sessionFile}.rex-process.json`;
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  try {
    try { linkSync(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), value, 'A different task process already owns this identity file');
  } finally { unlinkSync(temporary); }
}

export function boundedSummary(file, at = '9999') {
  if (!existsSync(file)) return 'The retained task session has no transcript yet.';
  const descriptor = openSync(file, 'r');
  let text;
  try {
    const size = statSync(file).size;
    const offset = Math.max(0, size - 128 * 1024);
    const bytes = Buffer.alloc(size - offset);
    readSync(descriptor, bytes, 0, bytes.length, offset);
    text = bytes.toString('utf8');
    if (offset) text = text.slice(text.indexOf('\n') + 1);
  } finally { closeSync(descriptor); }
  let summary;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.timestamp <= at) {
      const value = entry.message.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      if (value) summary = value;
    }
  }
  return summary?.slice(-16_000) ?? 'The result is outside the bounded transcript tail. Open the retained task session to read it.';
}

export function taskState(record, activity, events, ledger, alive) {
  if (record.failure) return { state: 'unknown', reason: record.failure };
  if (record.dispatching) return { state: 'unknown', reason: 'A dispatch may already have reached this agent; verify it before retrying' };
  if (record.stopConfirmed) return { state: 'stopped', reason: 'Agent process exit confirmed' };
  if (record.completed) return { state: record.completed.error ? 'error' : 'done', reason: record.completed.error ?? 'Result delivered' };
  if (alive !== true) return { state: 'unknown', reason: alive === false ? 'Agent exited; completion is unconfirmed' : 'Agent identity is unverified' };
  const dispatched = ledger.filter((row) => row.outcome === 'dispatched').at(-1);
  const task = dispatched?.task ?? record.taskId;
  const event = events.filter((row) => row.task === task).at(-1);
  const help = events.filter((row) => row.task === task && row.type === 'help-request').at(-1);
  if (help) return { state: 'blocked', reason: cleanText(help.message) || 'Agent requested help' };
  if (record.stopRequested) return { state: 'stopping', reason: 'Waiting for confirmed agent exit' };
  if (event?.type === 'task-done' && (!activity?.agentActive || activity.updatedAt <= Date.parse(event.at))) return { state: 'done', reason: 'Finished; available for follow-up' };
  if (activity?.phase === 'active') return { state: 'working', reason: cleanText(activity.toolName ?? activity.activeScope) };
  if (activity?.phase === 'waiting') return { state: 'idle', reason: 'Waiting for a task' };
  return { state: 'unknown', reason: 'No current activity evidence' };
}

export class TaskStore {
  constructor(root = taskRoot()) { this.root = root; }
  file(id) {
    assert.match(id, /^[a-zA-Z0-9-]+$/, 'Invalid task ID');
    return join(this.root, `${id}.json`);
  }
  read(id) {
    const file = this.file(id);
    if (!existsSync(file)) return undefined;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(value.version, 1, `Invalid task record: ${file}`);
    assert.equal(value.id, id);
    assert.match(value.surface, /^session:[a-zA-Z0-9-]+\/block:[a-zA-Z0-9-]+$/);
    assert.ok(isAbsolute(value.sessionFile) && isAbsolute(value.activityFile) && isAbsolute(value.originCwd));
    assert.ok(Number.isInteger(value.owner.pid) && value.owner.pid > 0);
    if (value.inboxSequence !== undefined) assert.ok(Number.isSafeInteger(value.inboxSequence) && value.inboxSequence >= 0);
    return value;
  }
  list() {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((name) => name.endsWith('.json')).map((name) => this.read(name.slice(0, -5)));
  }
  write(record) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = this.file(record.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  }
  exclusive(id, operation) {
    const lock = `${this.file(id)}.lock`;
    mkdirSync(lock, { mode: 0o700 });
    const owner = join(lock, 'owner.json');
    try {
      writeFileSync(owner, JSON.stringify({ pid: process.pid, birth: processBirth(process.pid), session: process.env.REX_SESSION, createdAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
      return operation();
    } finally {
      if (existsSync(owner)) unlinkSync(owner);
      rmdirSync(lock);
    }
  }
}
