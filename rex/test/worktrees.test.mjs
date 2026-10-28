import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RexWorktrees, git, registeredWorktrees } from '../src/worktrees.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rex-worktrees-')));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Rex test']);
  git(repo, ['config', 'user.email', 'rex-test@example.invalid']);
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git(repo, ['add', 'tracked.txt']);
  git(repo, ['commit', '-m', 'Initial test fixture']);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessions = new Map();
  let count = 0;
  const provider = {
    sessions: new Set(),
    json: () => ({ sessions: [...sessions.keys()].map((session_id) => ({ session_id })) }),
    createSurface: ({ cwd }) => {
      const session = `session:test-${++count}`;
      const surfaceId = `${session}/block:test-${count}`;
      sessions.set(session, { id: surfaceId, cwd });
      return surfaceId;
    },
    listSurfaces: async () => [...sessions.values()],
    waitForShellReady: async () => {},
    process: (surface) => ({ foreground: { cwd: [...sessions.values()].find((entry) => entry.id === surface)?.cwd } }),
    closeSurface: (surface) => {
      for (const [session, entry] of sessions) if (entry.id === surface) sessions.delete(session);
    },
  };
  const manager = new RexWorktrees(provider, { root: join(root, 'rex') });
  manager.checkHolders = async () => ({ blockers: [], warnings: [] });
  const create = (branch = 'feat/task') => manager.create({ name: 'test', cwd: repo, branch, base });
  const complete = (surface) => {
    const record = manager.records().find((entry) => entry.path === surface.path);
    manager.recordManifest(join(root, 'manifest.json'), { id: 'run-1', path: surface.path, sessionFile: 'task-session' });
    manager.release({ customType: 'subagent_stop', details: { status: 'stopped', facts: { logicalId: 'run-1' } } });
    assert.equal(manager.records().find((entry) => entry.key === record.key).lease, null);
  };
  t.diagnostic(`Fixture retained for inspection at ${root}`);
  return { root, repo, base, manager, provider, sessions, create, complete };
}

test('creates an isolated branch and does not copy principal checkout edits', async (t) => {
  const { repo, manager, create } = fixture(t);
  writeFileSync(join(repo, 'tracked.txt'), 'principal edit\n');
  const surface = await create();
  assert.equal(readFileSync(join(surface.path, 'tracked.txt'), 'utf8'), 'base\n');
  assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'principal edit\n');
  assert.equal(git(surface.path, ['branch', '--show-current']).trim(), 'feat/task');
  assert.equal(manager.records()[0].surfaceId, surface.surfaceId);
  assert.equal(registeredWorktrees(repo).length, 2);
});

test('active coordinator lease blocks duplicate acquisition across manager instances', async (t) => {
  const { manager, provider, create } = fixture(t);
  await create();
  const competing = new RexWorktrees(provider, { root: manager.root });
  competing.checkHolders = async () => ({ blockers: [], warnings: [] });
  const record = manager.records()[0];
  await assert.rejects(competing.create({ name: 'duplicate', cwd: record.repo, branch: record.branch, base: record.baseSha }), /live Rex coordinator/);
});

test('confirmed stop permits reuse of the same checkout and session, including retained edits', async (t) => {
  const { manager, create, complete, sessions } = fixture(t);
  const first = await create();
  writeFileSync(join(first.path, 'task.txt'), 'keep this task work\n');
  complete(first);
  const second = await create();
  assert.deepEqual(second, first);
  assert.equal(readFileSync(join(second.path, 'task.txt'), 'utf8'), 'keep this task work\n');
  assert.equal(sessions.size, 1);
  assert.equal(manager.records().length, 1);
});

test('task completion and an unconfirmed crash do not release a persistent lease', async (t) => {
  const { root, create, manager } = fixture(t);
  const surface = await create();
  const sessionFile = join(root, 'session.jsonl');
  writeFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, JSON.stringify({ persistent: true }));
  manager.recordManifest('test.json', { id: 'run-1', path: surface.path, sessionFile });
  manager.release({ customType: 'subagent_result', details: { logicalId: 'run-1', sessionFile, worktree: surface } });
  manager.release({ customType: 'subagent_result', details: { error: 'persistent-crash', facts: { logicalId: 'run-1' } } });
  assert.equal(manager.records()[0].lease.pid, process.pid);
  await assert.rejects(create(), /live Rex coordinator/);
});

test('a completed nonpersistent task releases its matching lease only', async (t) => {
  const { root, create, manager } = fixture(t);
  const surface = await create();
  const sessionFile = join(root, 'session.jsonl');
  writeFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, JSON.stringify({ persistent: false }));
  manager.recordManifest('test.json', { id: 'run-1', path: surface.path, sessionFile });
  manager.release({ customType: 'subagent_result', details: { sessionFile: 'another-task', worktree: surface } });
  assert.equal(manager.records()[0].lease.pid, process.pid);
  manager.release({ customType: 'subagent_result', details: { sessionFile, worktree: surface } });
  assert.equal(manager.records()[0].lease, null);
});

test('a task worktree cannot create another worktree of its own repository', async (t) => {
  const { create, manager, base, repo } = fixture(t);
  const surface = await create();
  await assert.rejects(manager.create({ name: 'nested', cwd: surface.path, branch: 'feat/nested', base }), /principal repository checkout/);
  assert.equal(registeredWorktrees(repo).length, 2);
});

test('external processes and unknown process state block reuse', async (t) => {
  const { create, complete, manager } = fixture(t);
  complete(await create());
  manager.checkHolders = async () => ({ blockers: ['Live process holds the checkout'], warnings: [] });
  await assert.rejects(create(), /Live process/);
  manager.checkHolders = async () => { throw new Error('Process enumeration failed'); };
  await assert.rejects(create(), /Process enumeration failed/);
});

test('a missing old session can be replaced without creating a second checkout', async (t) => {
  const { create, complete, sessions, repo } = fixture(t);
  const first = await create();
  complete(first);
  sessions.delete(first.surfaceId.split('/')[0]);
  const second = await create();
  assert.equal(second.path, first.path);
  assert.notEqual(second.workspaceId, first.workspaceId);
  assert.equal(registeredWorktrees(repo).length, 2);
});

test('never adopts an existing unmanaged task checkout', async (t) => {
  const { create, repo, root } = fixture(t);
  const existing = join(root, 'external');
  git(repo, ['worktree', 'add', '-b', 'feat/task', existing]);
  await assert.rejects(create(), /already has a checkout/);
  assert.equal(registeredWorktrees(repo).length, 2);
});

test('changed branch identity and symlink escapes block reuse', async (t) => {
  const { create, complete } = fixture(t);
  const first = await create();
  complete(first);
  git(first.path, ['switch', '-c', 'feat/other']);
  await assert.rejects(create(), /identity changed/);
});

test('refuses symbolic links in the worktree destination', async (t) => {
  const { manager, root, create } = fixture(t);
  mkdirSync(manager.root, { recursive: true });
  symlinkSync(root, manager.checkouts);
  await assert.rejects(create(), /symbolic link/);
});

test('explicit removal refuses dirty work, then retains branch commits when clean', async (t) => {
  const { create, complete, manager, repo } = fixture(t);
  const surface = await create();
  await assert.rejects(manager.removeWorkspace(surface.workspaceId), /live Rex coordinator/);
  complete(surface);
  writeFileSync(join(surface.path, 'tracked.txt'), 'task edit\n');
  await assert.rejects(manager.removeWorkspace(surface.workspaceId));
  assert.equal(existsSync(surface.path), true);
  git(surface.path, ['add', 'tracked.txt']);
  git(surface.path, ['commit', '-m', 'Keep task changes']);
  const head = git(surface.path, ['rev-parse', 'HEAD']).trim();
  await manager.removeWorkspace(surface.workspaceId);
  assert.equal(existsSync(surface.path), false);
  assert.equal(git(repo, ['rev-parse', 'feat/task']).trim(), head);
  await assert.rejects(create(), /explicitly removed/);
});

test('one operation lock serializes acquisition and cleanup', async (t) => {
  const { manager } = fixture(t);
  let release;
  const first = manager.exclusive(() => new Promise((resolve) => { release = resolve; }));
  const owner = join(manager.root, 'worktree-operation.lock/owner.json');
  assert.equal(JSON.parse(readFileSync(owner, 'utf8')).pid, process.pid);
  await assert.rejects(manager.exclusive(async () => {}), /Another Rex worktree operation/);
  release();
  await first;
  assert.equal(existsSync(owner), false);
  await manager.exclusive(async () => {});
});

test('repository identity is passed through while each task retains a unique cleanup target', async (t) => {
  const { create, complete, provider, manager, repo, base, sessions } = fixture(t);
  const surfaces = new Map();
  let count = 0;
  provider.createSurface = ({ cwd, repo: source }) => {
    assert.equal(source, repo);
    const id = `session:shared/block:task-${++count}`;
    surfaces.set(id, { id, cwd });
    sessions.set('session:shared', {});
    return id;
  };
  provider.listSurfaces = async () => [...surfaces.values()];
  provider.process = (surface) => ({ foreground: { cwd: surfaces.get(surface)?.cwd } });
  provider.closeSurface = (surface) => { surfaces.delete(surface); };
  const first = await create();
  const second = await create('feat/second');
  assert.notEqual(first.workspaceId, second.workspaceId);
  assert.equal(sessions.size, 1);
  complete(first);
  await manager.removeWorkspace(first.workspaceId);
  assert.equal(surfaces.has(second.surfaceId), true);
  assert.equal(existsSync(second.path), true);
  assert.equal(sessions.size, 1);
  assert.equal((await manager.list({ cwd: repo }))[0].workspaceId, second.workspaceId);
  await assert.rejects(manager.create({ name: 'second', cwd: repo, branch: 'feat/second', base }), /live Rex coordinator/);
});

test('legacy session-scoped task identities still reuse their original terminal', async (t) => {
  const { create, complete, manager } = fixture(t);
  const first = await create();
  const record = manager.records()[0];
  record.workspaceId = first.surfaceId.split('/')[0];
  manager.save(record);
  complete(first);
  const reused = await create();
  assert.equal(reused.workspaceId, record.workspaceId);
  assert.equal(reused.surfaceId, first.surfaceId);
});

test('linked worktrees resolve to the same canonical repository', async (t) => {
  const { repositoryFor } = await import('../src/provider.mjs');
  const { repo, create } = fixture(t);
  const first = await create();
  assert.equal(repositoryFor(first.path), repo);
  assert.equal(repositoryFor(repo), repo);
});
