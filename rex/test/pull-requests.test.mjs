import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PullRequestStore, PullRequestWatcher, isConnectivityError, outageOf, prIdentity } from '../src/pull-request-watcher.ts';

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

test('discovers task PRs and notifies on merge without running cleanup', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture();
  await f.watcher.tick();
  assert.equal(f.messages.length, 0);
  assert.equal(f.store.list('/coordinator')[0].state, 'OPEN');
  f.pr.state = 'MERGED'; f.pr.mergedAt = '2026-10-27T00:00:00Z';
  context.mock.timers.tick(300000);
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

test('uncertain deliveries are summarized once and skip PRs whose cleanup is decided', async () => {
  const f = fixture();
  const row = (url, cleanup) => ({ version: 1, origin: '/coordinator', url, taskId: 't', name: 'n', checkout: '/c', repositoryPath: '/r', branch: 'b', state: 'MERGED', mergedAt: 'now', cleanup, notification: 'pending' });
  for (const [number, cleanup] of [[11, 'pending'], [12, 'pending'], [13, 'removed'], [14, 'retained']]) f.store.write(row(`https://github.com/o/r/pull/${number}`, cleanup));
  const watcher = new PullRequestWatcher({ ...f.options, tasks: () => [] });
  watcher.start(); await watcher.pending; await watcher.close();
  assert.deepEqual(f.notices, ['Merge notification delivery is uncertain for 2 merged PRs. They wait in the command center Inbox under "Merged, cleanup pending"; cleanup still needs approval.']);
});

test('closed unmerged PRs are not treated as merged and reopened PRs remain watched', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); f.pr.state = 'CLOSED';
  await f.watcher.tick(); assert.equal(f.messages.length, 0);
  context.mock.timers.tick(300000);
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

test('a user retention decision survives restarts and successful cleanup is reconciled', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); await f.watcher.tick(); f.watcher.retain(f.pr.url);
  await f.watcher.close();
  const replacement = new PullRequestWatcher(f.options);
  context.mock.timers.tick(300000);
  f.pr.state = 'MERGED'; f.pr.mergedAt = 'now'; await replacement.tick();
  assert.equal(f.messages.length, 0);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'retained');
  f.records[0].removed = true; replacement.reconcileCleanup(f.records);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'removed');
  await replacement.close();
});

test('a partial force cleanup takes a merged PR out of the approvals until its checkout is finally removed', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); f.pr.state = 'MERGED'; f.pr.mergedAt = 'now'; await f.watcher.tick();
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'pending');
  f.watcher.markResidual('/elsewhere', 'Kept /elsewhere');
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'pending');
  f.watcher.markResidual(f.records[0].path, 'Kept it: Live process 4242 holds the checkout.');
  assert.deepEqual([f.store.list('/coordinator')[0].cleanup, f.store.list('/coordinator')[0].residual], ['residual', 'Kept it: Live process 4242 holds the checkout.']);
  context.mock.timers.tick(300000);
  await f.watcher.tick();
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'residual');
  f.watcher.markResidual(f.records[0].path, 'Kept it: Dirty worktree.');
  assert.equal(f.store.list('/coordinator')[0].residual, 'Kept it: Dirty worktree.');
  f.records[0].removed = true; f.watcher.reconcileCleanup(f.records);
  assert.equal(f.store.list('/coordinator')[0].cleanup, 'removed');
  await f.watcher.close();
});

test('API failures preserve prior state and do not claim a merge', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); await f.watcher.tick();
  f.watcher.query = async () => { throw new Error('authentication failed'); };
  context.mock.timers.tick(300000); await f.watcher.tick();
  context.mock.timers.tick(300000); await f.watcher.tick();
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

test('origin boundaries exclude other coordinators and missing or removed checkouts', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); f.task.originCwd = '/another'; await f.watcher.tick();
  assert.equal(f.queries.length, 0);
  context.mock.timers.tick(300000);
  f.task.originCwd = '/coordinator'; f.records[0].removed = true; await f.watcher.tick();
  assert.equal(f.queries.length, 0); await f.watcher.close();
});

test('a sweep held by a live coordinator is skipped quietly and the lock is released after it', async () => {
  const f = fixture(); let unblock;
  const lock = f.store.exclusive('/coordinator', () => new Promise((resolve) => { unblock = resolve; }));
  await f.watcher.tick();
  assert.deepEqual(f.notices, []); assert.equal(f.queries.length, 0);
  unblock(); await lock;
  assert.deepEqual(readdirSync(f.root).filter((name) => name.includes('.lock')), []);
  await f.watcher.tick(); assert.equal(f.store.list('/coordinator').length, 1);
  await f.watcher.close();
});

test('registration waits for an in-flight sweep instead of failing on its lock', async () => {
  const f = fixture(); let unblock;
  f.watcher.query = (args) => new Promise((resolve) => { unblock = () => resolve(f.options.query(args)); });
  const sweep = f.watcher.tick(); await new Promise((resolve) => setImmediate(resolve));
  f.watcher.query = f.options.query;
  const registration = f.watcher.track('task-a', f.pr.url);
  unblock(); await sweep;
  assert.equal((await registration).url, f.pr.url);
  assert.deepEqual(f.notices, []);
  await f.watcher.close();
});

test('URL validation rejects shell-like values and non-GitHub origins', () => {
  for (const value of ['https://evil.test/x/y/pull/1', 'https://github.com/x/y/pull/1;touch', '--repo=x', 'https://github.com/x/y/pull/0']) {
    assert.throws(() => prIdentity(value));
  }
});

test('scheduled checks detect a merge and shutdown stops the watcher timer', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture(); f.watcher.start(); await f.watcher.pending;
  await new Promise(setImmediate);
  assert.equal(f.queries.length, 2);
  f.pr.state = 'MERGED'; f.pr.mergedAt = 'now';
  context.mock.timers.tick(299999);
  assert.equal(f.queries.length, 2, 'nothing runs before the due time');
  context.mock.timers.tick(1); await f.watcher.pending;
  assert.equal(f.queries.length, 4, 'the timer wakes at the shared due time and sweeps');
  assert.equal(f.messages.length, 1);
  await f.watcher.close(); const count = f.queries.length;
  context.mock.timers.tick(300000);
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

function crowd({ repos = 2, perRepo = 6 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rex-prs-crowd-'));
  const store = new PullRequestStore(root);
  const tasks = []; const records = []; const queries = []; const messages = []; const notices = [];
  for (let r = 0; r < repos; r++) for (let t = 0; t < perRepo; t++) {
    const branch = `feat/r${r}-t${t}`;
    tasks.push({ id: `task-${r}-${t}`, name: `task ${r}-${t}`, originCwd: '/coordinator', worktree: `/checkout/${r}-${t}`, branch });
    records.push({ path: `/checkout/${r}-${t}`, repo: `/repository/${r}`, branch });
  }
  const states = new Map();
  let failure;
  let rateLimit = { resources: { graphql: { remaining: 0, reset: 0 }, core: { remaining: 4000, reset: 0 } } };
  const query = async (args, cwd) => {
    queries.push({ args, cwd });
    if (args[0] === 'api') return rateLimit;
    if (failure?.(args, queries.length)) throw failure.error;
    const name = `example/project-${cwd.split('/').pop()}`;
    if (args[0] === 'repo') return { nameWithOwner: name };
    const branch = args[1] === 'list' ? args[args.indexOf('--head') + 1] : tasks.find((task) => args[2].endsWith(`/pull/${tasks.indexOf(task) + 1}`)).branch;
    const number = tasks.findIndex((task) => task.branch === branch) + 1;
    const pr = { url: `https://github.com/${name}/pull/${number}`, state: states.get(number) ?? 'OPEN', mergedAt: states.get(number) === 'MERGED' ? '2026-11-21T00:00:00Z' : null, headRefName: branch, headRefOid: 'abc', headRepository: { nameWithOwner: name } };
    return args[1] === 'list' ? [pr] : pr;
  };
  const options = { store, origin: '/coordinator', tasks: () => tasks, records: () => records, send: (message) => messages.push(message), notify: (message) => notices.push(message), query };
  return { root, store, tasks, queries, messages, notices, states, options,
    fail: (error, when = () => true) => { failure = Object.assign(when, { error }); }, heal: () => { failure = undefined; },
    setRateLimit: (value) => { rateLimit = value; },
    count: (kind) => queries.filter(({ args }) => args.slice(0, 2).join(' ') === kind).length };
}

test('one sweep asks GitHub for each repository name once, however many tasks share it', async (context) => {
  context.mock.timers.enable({ apis: ['Date'] });
  const f = crowd({ repos: 2, perRepo: 6 });
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  assert.equal(f.count('repo view'), 2);
  assert.equal(f.count('pr list'), 12);
  assert.equal(f.store.list('/coordinator').length, 12);
  context.mock.timers.tick(300000);
  await watcher.tick();
  assert.equal(f.count('repo view'), 4, 'the cache lasts one sweep');
  assert.equal(f.count('pr view'), 12);
  assert.equal(f.count('pr list'), 12);
  await watcher.close();
});

test('an exhausted GraphQL quota stops the sweep at once, pauses every coordinator until the reset, then one merge is announced once', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 1, perRepo: 8 });
  const reset = Date.parse('2026-11-21T12:40:00Z');
  f.setRateLimit({ resources: { graphql: { remaining: 0, reset: reset / 1000 }, core: { remaining: 4000, reset: reset / 1000 } } });
  f.fail(Object.assign(new Error('Command failed: gh pr list'), { stderr: 'GraphQL: API rate limit exceeded for user ID 1.' }), (args) => args[1] === 'list' && f.count('pr list') >= 3);
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  assert.equal(f.count('pr list'), 3, 'no further candidates are tried after the quota runs out');
  assert.equal(f.count('api rate_limit'), 1);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /PR checks paused: the GitHub API rate limit is used up\. Watches stay registered and checks resume at/);
  assert.equal(f.store.sweep('/coordinator').dueAt, reset);
  const before = f.queries.length;
  await watcher.tick();
  await watcher.close();
  const reloaded = new PullRequestWatcher(f.options);
  const rival = new PullRequestWatcher(f.options);
  await reloaded.tick(); await rival.tick();
  assert.equal(f.queries.length, before, 'the cooldown is shared across ticks, reloads and coordinators');
  assert.equal(f.notices.length, 1, 'one warning for the whole outage');
  f.heal();
  f.states.set(5, 'MERGED');
  context.mock.timers.setTime(reset + 1000);
  await reloaded.tick();
  assert.equal(f.count('pr list'), 3 + 6, 'the six unchecked branches are discovered');
  assert.equal(f.count('pr view'), 2, 'the two found before the outage are rechecked');
  assert.deepEqual(f.notices.slice(1), ['PR checks resumed: GitHub is reachable again.']);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].content, /pull\/5/);
  await rival.tick(); await reloaded.tick();
  assert.equal(f.messages.length, 1, 'the merge is announced once');
  assert.equal(f.notices.length, 2);
  await reloaded.close(); await rival.close();
});

test('a secondary rate limit without a readable reset waits the default cooldown', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 1, perRepo: 2 });
  f.setRateLimit({ resources: { graphql: { remaining: 4000, reset: 0 } } });
  f.fail(Object.assign(new Error('gh failed'), { stderr: 'HTTP 403: You have exceeded a secondary rate limit.' }));
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  assert.equal(f.store.sweep('/coordinator').dueAt, Date.parse('2026-11-21T12:15:00Z'));
  assert.equal(f.count('repo view'), 1);
  await watcher.close();
});

test('a network outage stops the sweep, warns once across reloads and resumes on the next healthy check', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 3, perRepo: 3 });
  f.fail(Object.assign(new Error('Command failed: gh repo view'), { stderr: 'Post "https://api.github.com/graphql": EOF' }));
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  assert.equal(f.queries.length, 1, 'the first failure ends the sweep');
  assert.deepEqual(f.notices, ['PR checks paused: GitHub could not be reached (Post "https://api.github.com/graphql": EOF). Watches stay registered and checks retry every 5 minutes.']);
  await watcher.close();
  const reloaded = new PullRequestWatcher(f.options);
  await reloaded.tick();
  assert.equal(f.queries.length, 1, 'a reload waits for the shared due time');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:05:00Z'));
  f.fail(Object.assign(new Error('read tcp 10.0.0.2:5555->140.82.112.6:443: read: connection reset by peer'), {}));
  await reloaded.tick();
  assert.equal(f.queries.length, 2);
  assert.equal(f.notices.length, 1, 'the same outage is not announced again');
  f.heal();
  f.states.set(2, 'MERGED');
  await reloaded.tick();
  assert.equal(f.queries.length, 2, 'a healed network still waits for the due time');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:10:00Z'));
  await reloaded.tick();
  assert.deepEqual(f.notices.slice(1), ['PR checks resumed: GitHub is reachable again.']);
  assert.equal(f.store.list('/coordinator').length, 9);
  assert.equal(f.messages.length, 1);
  await reloaded.tick();
  assert.equal(f.messages.length, 1);
  assert.equal(f.notices.length, 2);
  await reloaded.close();
});

test('a reloaded or competing coordinator skips GitHub until the shared sweep is due, but still delivers merges', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 1, perRepo: 4 });
  const first = new PullRequestWatcher(f.options);
  await first.tick();
  const swept = f.queries.length;
  assert.equal(swept, 5);
  const rival = new PullRequestWatcher(f.options);
  await rival.tick();
  await first.close();
  const reloaded = new PullRequestWatcher(f.options);
  await reloaded.tick();
  assert.equal(f.queries.length, swept, 'neither a competing nor a reloaded coordinator repeats the sweep');
  const row = f.store.list('/coordinator')[0];
  f.store.write({ ...row, state: 'MERGED', mergedAt: '2026-11-21T00:00:00Z' });
  await rival.tick();
  assert.equal(f.messages.length, 1, 'a merge recorded by manual tracking is still announced without a sweep');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:04:59Z'));
  await reloaded.tick();
  assert.equal(f.queries.length, swept, 'not a moment early');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:05:00Z'));
  await reloaded.tick();
  assert.equal(f.queries.length, swept + 4, 'the next due sweep runs once');
  await rival.tick();
  assert.equal(f.queries.length, swept + 4);
  assert.equal(f.messages.length, 1);
  await rival.close(); await reloaded.close();
});

test('connectivity and quota failures are told apart from real errors', () => {
  const failure = (stderr) => Object.assign(new Error('Command failed: gh'), { stderr });
  for (const stderr of ['Post "https://api.github.com/graphql": EOF', 'read: connection reset by peer', 'net/http: TLS handshake timeout', 'dial tcp: lookup api.github.com: no such host', 'context deadline exceeded', 'error connecting to api.github.com']) {
    assert.equal(outageOf(failure(stderr)), 'network', stderr);
    assert.equal(isConnectivityError(failure(stderr)), true, stderr);
  }
  assert.equal(outageOf(Object.assign(new Error('Command failed: gh pr list'), { killed: true, signal: 'SIGTERM' })), 'network');
  for (const stderr of ['GraphQL: API rate limit exceeded for user ID 1.', 'HTTP 403: You have exceeded a secondary rate limit.', 'HTTP 429: Too Many Requests', 'was submitted too quickly']) {
    assert.equal(outageOf(failure(stderr)), 'rate', stderr);
  }
  for (const stderr of ['authentication failed', 'GraphQL: Could not resolve to a PullRequest with the number of 12.', 'no git remotes found']) {
    assert.equal(outageOf(failure(stderr)), undefined, stderr);
  }
});

test('the watcher that wrote the due time obeys it too, after a healthy sweep and after an outage', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 1, perRepo: 3 });
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  assert.equal(f.queries.length, 4);
  assert.equal(f.store.sweep('/coordinator').dueAt, Date.parse('2026-11-21T12:05:00Z'));
  await watcher.tick(); await watcher.tick();
  assert.equal(f.queries.length, 4, 'two immediate ticks after a healthy sweep ask GitHub nothing');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:05:00Z'));
  f.fail(Object.assign(new Error('Command failed: gh repo view'), { stderr: 'Post "https://api.github.com/graphql": EOF' }));
  await watcher.tick();
  assert.equal(f.queries.length, 5);
  await watcher.tick(); await watcher.tick();
  assert.equal(f.queries.length, 5, 'two immediate ticks during an outage ask GitHub nothing');
  assert.equal(f.notices.length, 1);
  f.heal();
  context.mock.timers.setTime(Date.parse('2026-11-21T12:10:00Z'));
  await watcher.tick();
  assert.equal(f.queries.length, 5 + 4, 'the deadline admits the same watcher');
  await watcher.close();
  const reloaded = new PullRequestWatcher(f.options);
  const rival = new PullRequestWatcher(f.options);
  await reloaded.tick(); await rival.tick();
  assert.equal(f.queries.length, 9);
  context.mock.timers.setTime(Date.parse('2026-11-21T12:15:00Z'));
  await rival.tick();
  assert.equal(f.queries.length, 9 + 4, 'the deadline admits a rival');
  await reloaded.tick();
  assert.equal(f.queries.length, 13, 'and only one of them');
  context.mock.timers.setTime(Date.parse('2026-11-21T12:20:00Z'));
  await reloaded.tick();
  assert.equal(f.queries.length, 13 + 4, 'and then a reloaded watcher');
  await reloaded.close(); await rival.close();
});

test('recovery is announced only after GitHub actually answers, not for candidates with nothing to ask', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const f = crowd({ repos: 1, perRepo: 3 });
  const watcher = new PullRequestWatcher(f.options);
  await watcher.tick();
  for (const [index, row] of f.store.list('/coordinator').entries()) {
    f.store.write(index === 0 ? { ...row, state: 'MERGED', mergedAt: '2026-11-21T00:00:00Z', notification: 'delivered' } : { ...row, cleanup: 'retained' });
  }
  f.store.writeSweep('/coordinator', { dueAt: Date.parse('2026-11-21T12:01:00Z'), outage: 'network' });
  const before = f.queries.length;
  context.mock.timers.setTime(Date.parse('2026-11-21T12:01:00Z'));
  await watcher.tick();
  assert.equal(f.queries.length, before, 'terminal rows need no GitHub request');
  assert.deepEqual(f.notices, [], 'no request, so no claim that GitHub is reachable');
  assert.equal(f.store.sweep('/coordinator').outage, 'network');
  const row = f.store.list('/coordinator').find((entry) => entry.cleanup === 'retained');
  f.store.write({ ...row, cleanup: 'pending' });
  context.mock.timers.setTime(Date.parse('2026-11-21T12:06:00Z'));
  await watcher.tick();
  assert.equal(f.queries.length, before + 2, 'one repository name and one PR view');
  assert.deepEqual(f.notices, ['PR checks resumed: GitHub is reachable again.']);
  assert.equal(f.store.sweep('/coordinator').outage, undefined);
  context.mock.timers.setTime(Date.parse('2026-11-21T12:11:00Z'));
  await watcher.tick();
  assert.equal(f.notices.length, 1, 'recovery is announced once');
  assert.equal(f.messages.length, 0, 'the delivered merge is not announced again');
  await watcher.close();
});
