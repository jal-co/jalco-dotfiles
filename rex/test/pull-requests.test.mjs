import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PullRequestStore, PullRequestWatcher, prIdentity } from '../src/pull-requests.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-prs-'));
  const store = new PullRequestStore(root);
  const task = { id: 'task-a', logicalId: 'logical-a', name: 'fixture', originCwd: '/coordinator', worktree: '/checkout', branch: 'feat/test' };
  const records = [{ path: '/checkout', repo: '/repository', branch: 'feat/test' }];
  const messages = []; const notices = []; const queries = [];
  const pr = { url: 'https://github.com/example/project/pull/12', state: 'OPEN', mergedAt: null, headRefName: task.branch, headRefOid: 'abc', headRepository: { nameWithOwner: 'example/project' } };
  const options = { store, origin: task.originCwd, tasks: () => [task], records: () => records,
    send: (message) => messages.push(message), notify: (message) => notices.push(message), query: async (args) => {
      queries.push(args);
      return args[0] === 'repo' ? { nameWithOwner: 'example/project' } : args[1] === 'list' ? [{ ...pr }] : { ...pr };
    } };
  return { root, store, task, records, messages, notices, queries, pr, options, watcher: new PullRequestWatcher(options) };
}

test('discovers task PRs and notifies on merge without running cleanup', async () => {
  const f = fixture();
  await f.watcher.tick();
  assert.equal(f.messages.length, 0);
  assert.equal(f.store.list('/coordinator')[0].state, 'OPEN');
  f.pr.state = 'MERGED'; f.pr.mergedAt = '2026-10-27T00:00:00Z';
  await f.watcher.tick();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].content, /not cleanup approval/);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'pending');
  assert.deepEqual(f.records, [{ path: '/checkout', repo: '/repository', branch: 'feat/test' }]);
  assert.ok(f.queries.every((args) => ['repo', 'pr'].includes(args[0]) && ['view', 'list'].includes(args[1])));
  await f.watcher.close();
});

test('delivered merge notifications do not replay after restart', async () => {
  const f = fixture(); f.pr.state = 'MERGED'; f.pr.mergedAt = 'now';
  await f.watcher.tick(); f.watcher.receipt(f.messages[0]); await f.watcher.close();
  const replacement = new PullRequestWatcher(f.options);
  await replacement.tick(); await replacement.close();
  assert.equal(f.messages.length, 1);
  assert.equal(f.store.list('/coordinator')[0].notification, 'delivered');
});

test('crash between delivery and receipt reports uncertainty instead of replay', async () => {
  const f = fixture(); f.pr.state = 'MERGED'; f.pr.mergedAt = 'now';
  await f.watcher.tick(); await f.watcher.close();
  const replacement = new PullRequestWatcher(f.options);
  replacement.start(); await replacement.pending; await replacement.close();
  assert.equal(f.messages.length, 1);
  assert.match(f.notices[0], /uncertain/);
});

test('closed unmerged PRs are not treated as merged and reopened PRs remain watched', async () => {
  const f = fixture(); f.pr.state = 'CLOSED';
  await f.watcher.tick(); assert.equal(f.messages.length, 0);
  f.pr.state = 'OPEN'; await f.watcher.tick();
  assert.equal(f.store.list('/coordinator')[0].state, 'OPEN');
  await f.watcher.close();
});

test('tracking checks repository and branch rather than trusting a supplied URL', async () => {
  const f = fixture();
  await assert.rejects(f.watcher.track('task-a', 'https://github.com/other/project/pull/12'), /repository differs/);
  f.pr.headRefName = 'other-branch';
  await assert.rejects(f.watcher.track('task-a', f.pr.url), /does not match/);
  assert.equal(f.store.list('/coordinator').length, 0);
  await f.watcher.close();
});

test('fork PRs cannot attach to same-named local branches', async () => {
  const f = fixture(); f.pr.headRepository.nameWithOwner = 'someone/project';
  await f.watcher.tick();
  assert.equal(f.store.list('/coordinator').length, 0);
  await f.watcher.close();
});

test('explicit registration persists and duplicate registration is idempotent', async () => {
  const f = fixture();
  await f.watcher.track('logical-a', f.pr.url); await f.watcher.track('task-a', f.pr.url);
  assert.equal(f.store.list('/coordinator').length, 1);
  await f.watcher.close();
});

test('a user retention decision survives restarts and successful cleanup is reconciled', async () => {
  const f = fixture(); await f.watcher.tick(); f.watcher.retain(f.pr.url);
  await f.watcher.close();
  const replacement = new PullRequestWatcher(f.options);
  f.pr.state = 'MERGED'; f.pr.mergedAt = 'now'; await replacement.tick();
  assert.equal(f.messages.length, 0);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'retained');
  f.records[0].removed = true; replacement.reconcileCleanup(f.records);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'removed');
  await replacement.close();
});

test('API failures preserve prior state and do not claim a merge', async () => {
  const f = fixture(); await f.watcher.tick();
  f.watcher.query = async () => { throw new Error('authentication failed'); };
  await f.watcher.tick(); await f.watcher.tick();
  assert.equal(f.messages.length, 0); assert.equal(f.notices.length, 1);
  assert.equal(f.store.list('/coordinator')[0].state, 'OPEN');
  await f.watcher.close();
});

test('overlapping ticks share one in-flight check and shutdown prevents stale notifications', async () => {
  const f = fixture(); let unblock;
  f.watcher.query = () => new Promise((resolve) => { unblock = resolve; });
  const first = f.watcher.tick(); const second = f.watcher.tick();
  const closing = f.watcher.close(); unblock({ nameWithOwner: 'example/project' });
  f.watcher.query = f.options.query;
  await Promise.all([first, second, closing]);
  assert.equal(f.messages.length, 0); assert.equal(f.store.list('/coordinator').length, 0);
});

test('origin boundaries exclude other coordinators and missing or removed checkouts', async () => {
  const f = fixture(); f.task.originCwd = '/another'; await f.watcher.tick();
  assert.equal(f.queries.length, 0);
  f.task.originCwd = '/coordinator'; f.records[0].removed = true; await f.watcher.tick();
  assert.equal(f.queries.length, 0); await f.watcher.close();
});

test('competing coordinators cannot run the same origin watcher concurrently', async () => {
  const f = fixture(); let unblock;
  const lock = f.store.exclusive('/coordinator', () => new Promise((resolve) => { unblock = resolve; }));
  await f.watcher.tick(); assert.match(f.notices[0], /busy or stale lock/);
  unblock(); await lock; await f.watcher.close();
});

test('URL validation rejects shell-like values and non-GitHub origins', () => {
  for (const value of ['https://evil.test/x/y/pull/1', 'https://github.com/x/y/pull/1;touch', '--repo=x', 'https://github.com/x/y/pull/0']) {
    assert.throws(() => prIdentity(value));
  }
});

test('scheduled checks detect a merge and shutdown stops the watcher timer', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture(); f.watcher.start(); await f.watcher.pending;
  f.pr.state = 'MERGED'; f.pr.mergedAt = 'now';
  context.mock.timers.tick(60000); await f.watcher.pending;
  assert.equal(f.messages.length, 1);
  await f.watcher.close(); const count = f.queries.length;
  context.mock.timers.tick(60000);
  assert.equal(f.queries.length, count);
});

test('reload waits for cancelled registration and does not persist a late response', async () => {
  const f = fixture(); let release;
  f.watcher.query = () => new Promise((resolve) => { release = resolve; });
  const registration = assert.rejects(f.watcher.track('task-a', f.pr.url), /stopped before registration/);
  const closing = f.watcher.close();
  f.watcher.query = f.options.query;
  release({ nameWithOwner: 'example/project' });
  await Promise.all([registration, closing]);
  assert.deepEqual(f.store.list('/coordinator'), []);
  await assert.rejects(f.watcher.track('task-a', f.pr.url), /watcher has stopped/);
});
