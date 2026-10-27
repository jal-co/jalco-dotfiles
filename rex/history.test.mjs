import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TaskHistory } from './history.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-history-'));
  const taskFile = join(root, 'task.jsonl'); const parentFile = join(root, 'parent.jsonl');
  writeFileSync(taskFile, '{"type":"session","id":"child-session"}\n{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"decision evidence"}]}}\n');
  writeFileSync(parentFile, '{"type":"session","id":"parent-session"}\n');
  const history = new TaskHistory(join(root, 'history'));
  const input = { checkout: { path: '/checkout', repo: '/repository', branch: 'feat/history' },
    tasks: [{ id: 'child', name: 'history-build', worktree: '/checkout', sessionFile: taskFile }],
    coordinatorSession: parentFile, pullRequests: [{ checkout: '/checkout', url: 'https://github.com/example/project/pull/1' }] };
  return { root, taskFile, parentFile, history, input };
}

test('cleanup archives exact task and coordinator logs without touching originals', () => {
  const f = fixture(); const task = readFileSync(f.taskFile); const parent = readFileSync(f.parentFile);
  const [record] = f.history.archive(f.input);
  assert.deepEqual(readFileSync(record.taskLog.archived), task);
  assert.deepEqual(readFileSync(record.coordinatorLog.archived), parent);
  assert.deepEqual(readFileSync(f.taskFile), task);
  assert.deepEqual(readFileSync(f.parentFile), parent);
  assert.equal(statSync(record.taskLog.archived).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.root, 'history', record.id)).mode & 0o777, 0o700);
});

test('history remains searchable after original logs disappear', () => {
  const f = fixture(); const [record] = f.history.archive(f.input);
  unlinkSync(f.taskFile); unlinkSync(f.parentFile);
  const restarted = new TaskHistory(join(f.root, 'history'));
  for (const query of ['history-build', 'feat/history', '/pull/1']) assert.equal(restarted.list(query)[0].id, record.id);
  restarted.verify(record);
  assert.match(readFileSync(record.taskLog.archived, 'utf8'), /decision evidence/);
});

test('retries are idempotent while newer logs create distinct snapshots', () => {
  const f = fixture(); const [first] = f.history.archive(f.input);
  const [second] = f.history.archive(f.input); assert.equal(first.id, second.id);
  writeFileSync(f.taskFile, readFileSync(f.taskFile, 'utf8') + '{"type":"message","message":{"role":"assistant","content":[]}}\n');
  const [third] = f.history.archive(f.input); assert.notEqual(third.id, first.id);
  assert.equal(f.history.list().length, 2);
});

test('missing or invalid logs block archival instead of silently losing memory', () => {
  const f = fixture(); unlinkSync(f.taskFile);
  assert.throws(() => f.history.archive(f.input), /ENOENT/);
  assert.deepEqual(f.history.list(), []);
  writeFileSync(f.taskFile, '{"type":"not-a-session"}\n');
  assert.throws(() => f.history.archive(f.input), /Not a Pi session/);
});

test('corrupt existing archives fail verification before cleanup can proceed', () => {
  const f = fixture(); const [record] = f.history.archive(f.input);
  writeFileSync(record.taskLog.archived, 'corrupt');
  assert.throws(() => f.history.archive(f.input), /verification failed/);
});

test('manifest session is archived even when a prior coordinator lost its task record', () => {
  const f = fixture(); f.input.tasks = [];
  f.input.checkout.manifest = { value: { id: 'lost', sessionFile: f.taskFile } };
  assert.equal(f.history.archive(f.input)[0].taskId, 'lost');
});

test('unlaunched checkouts need no invented log but launched manifests cannot lose theirs', () => {
  const f = fixture(); f.input.tasks = [];
  assert.deepEqual(f.history.archive(f.input), []);
  f.input.checkout.manifest = { value: {} };
  assert.throws(() => f.history.archive(f.input), /manifest has no session log/);
});
