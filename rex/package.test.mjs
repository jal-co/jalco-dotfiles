import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { git } from './worktrees.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);

test('pi-rex-agents is a local package with its own host and persistent child implementation', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'pi-rex-agents');
  assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
  const entry = readFileSync(join(root, 'index.ts'), 'utf8');
  assert.doesNotMatch(entry, /npm\/node_modules\/pi-herdr-agents|applyChildCompletionFix|__test__/);
  assert.match(entry, /runtimeState: hostState/);
  const launch = readFileSync(join(root, 'host/maestro/adapters/pi/launch.ts'), 'utf8');
  assert.match(launch, /PI_REX_AGENT=1/);
  assert.match(launch, /\.\.\/\.\.\/\.\.\/\.\.\/task.ts/);
  assert.match(readFileSync(join(root, 'host/LICENSE'), 'utf8'), /MIT License/);
});

test('the native package loads lifecycle and PR tools without modifying the installed Herdr host', async (context) => {
  const installed = join(agent, 'npm/node_modules/pi-herdr-agents/maestro/adapters/pi/child/subagent-done.ts');
  const before = existsSync(installed) ? readFileSync(installed, 'utf8') : null;
  const old = { REX_SESSION: process.env.REX_SESSION, HERDR_ENV: process.env.HERDR_ENV };
  process.env.REX_SESSION = 'session:package-test'; delete process.env.HERDR_ENV;
  context.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const loaded = await loadExtensions([join(root, 'index.ts')], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  for (const name of ['subagent', 'subagent_send', 'subagent_stop', 'worktree_list', 'worktree_remove', 'rex_pr_track', 'rex_task_history']) {
    assert.ok(extension.tools.has(name), name);
  }
  assert.ok(extension.commands.has('rex-prs'));
  const ctx = { sessionManager: { getBranch: () => [] }, ui: { setWidget() {}, notify() {}, setStatus() {} } };
  for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
  assert.equal(existsSync(installed) ? readFileSync(installed, 'utf8') : null, before);
});

test('cleanup isolates unrelated identity failures and refreshes retained adapters on reload', async (context) => {
  const fixture = realpathSync(mkdtempSync(join(homedir(), '.rex-cleanup-test-')));
  context.diagnostic(`Fixture retained for inspection at ${fixture}`);
  const old = Object.fromEntries(['REX_SESSION', 'HERDR_ENV', 'REX_TASK_ROOT', 'REX_HISTORY_ROOT', 'REX_PR_ROOT'].map((key) => [key, process.env[key]]));
  process.env.REX_TASK_ROOT = join(fixture, 'tasks');
  process.env.REX_HISTORY_ROOT = join(fixture, 'history');
  process.env.REX_PR_ROOT = join(fixture, 'pull-requests');
  const session = `session:cleanup-${Date.now()}`;
  process.env.REX_SESSION = session; delete process.env.HERDR_ENV;
  context.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const load = async () => {
    const loaded = await loadExtensions([join(root, 'index.ts')], fixture);
    assert.deepEqual(loaded.errors, []);
    return loaded.extensions[0];
  };
  const first = await load();
  const infrastructure = globalThis[Symbol.for('justin.rex.agent-infrastructure')].get(session);
  const { provider, worktrees, cleanupOperations, supervision } = infrastructure;
  worktrees.root = join(fixture, 'rex');
  worktrees.registry = join(worktrees.root, 'registry');
  worktrees.checkouts = join(worktrees.root, 'worktrees');
  cleanupOperations.managedRoot = () => worktrees.checkouts;
  provider.json = () => ({ sessions: [] });
  provider.createSurface = () => 'session:fixture/block:fixture';
  let processBlockers = [];
  worktrees.checkHolders = async () => ({ blockers: processBlockers, warnings: [] });
  cleanupOperations.holders = async (entry) => ({ blockers: [...worktrees.leaseHolders(entry.path), ...processBlockers], warnings: [] });
  const repo = join(fixture, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Rex test']);
  git(repo, ['config', 'user.email', 'rex-test@example.invalid']);
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git(repo, ['add', 'tracked.txt']);
  git(repo, ['commit', '-m', 'Initial test fixture']);
  const create = async (branch) => {
    const surface = await worktrees.create({ name: branch, cwd: repo, branch, base: 'HEAD' });
    const record = worktrees.records().find((row) => row.path === surface.path);
    record.lease = null;
    worktrees.save(record);
    return surface;
  };
  const good = await create('feat/good');
  const changed = await create('feat/changed');
  const locked = await create('feat/locked');
  const missing = await create('feat/missing');
  const symbolic = await create('feat/symbolic');
  const foreign = await create('feat/foreign');
  const otherRepo = join(fixture, 'other-repo');
  mkdirSync(otherRepo);
  git(otherRepo, ['init', '-b', 'main']);
  renameSync(join(foreign.path, '.git'), join(fixture, 'foreign.gitfile-retained'));
  writeFileSync(join(foreign.path, '.git'), `gitdir: ${join(otherRepo, '.git')}\n`);
  renameSync(symbolic.path, `${symbolic.path}-retained`);
  symlinkSync(good.path, symbolic.path);
  git(changed.path, ['switch', '-c', 'fix/renamed']);
  git(repo, ['worktree', 'lock', locked.path]);
  renameSync(missing.path, `${missing.path}-retained`);
  const ctx = { cwd: fixture, sessionManager: { getBranch: () => [] }, ui: { setWidget() {}, notify() {}, setStatus() {} } };
  const inventory = async (extension) => (await extension.tools.get('worktree_list').definition.execute('cleanup-test', {}, undefined, undefined, ctx)).details.entries;
  const check = async (extension) => {
    const rows = await inventory(extension);
    const healthy = rows.find((row) => row.path === good.path);
    assert.equal(healthy.classification, 'eligible', JSON.stringify(healthy));
    for (const target of [changed, locked, missing, symbolic, foreign]) {
      const row = rows.find((entry) => entry.path === target.path);
      assert.ok(row, `Missing inspection for ${target.path}`);
      assert.equal(row.classification, 'unknown');
      assert.ok(row.blockers.some((value) => /identity changed|missing|ENOENT|symbolic link|ownership/.test(value)), JSON.stringify(row));
    }
  };
  await check(first);
  cleanupOperations.listWorktrees = (source) => provider.listWorktreeSurfaces({ cwd: source });
  const rejected = (await inventory(first)).find((row) => row.path === good.path);
  assert.equal(rejected.classification, 'unknown');
  assert.ok(rejected.blockers.some((value) => /identity changed|Retained checkout is missing|symbolic link|source repository/.test(value)), JSON.stringify(rejected));
  for (const handler of first.handlers.get('session_shutdown') ?? []) await handler({ reason: 'reload' }, ctx);
  const second = await load();
  assert.equal(globalThis[Symbol.for('justin.rex.agent-infrastructure')].get(session), infrastructure);
  assert.equal(infrastructure.provider, provider);
  assert.equal(infrastructure.supervision, supervision);
  await check(second);
  const removalContext = { ...ctx, hasUI: true, ui: { ...ctx.ui, confirm: async () => true } };
  for (const target of [changed, locked, missing, symbolic, foreign]) {
    await assert.rejects(second.tools.get('worktree_remove').definition.execute('blocked-cleanup', { target: target.path }, undefined, undefined, removalContext), /identity changed|missing|symbolic link|source repository/);
  }
  assert.equal(existsSync(good.path), true);
  assert.equal(existsSync(changed.path), true);
  assert.equal(existsSync(locked.path), true);
  const record = worktrees.records().find((row) => row.path === good.path);
  assert.throws(() => cleanupOperations.inspectGit(good.path, otherRepo), /ownership is missing/);
  assert.throws(() => worktrees.verify({ ...record, repo: otherRepo }), /identity changed/);
  const alias = join(worktrees.checkouts, 'alias');
  symlinkSync(good.path, alias);
  assert.throws(() => worktrees.verify({ ...record, path: alias }), /symbolic link/);
  const escape = join(worktrees.checkouts, 'escape');
  symlinkSync(repo, escape);
  assert.throws(() => worktrees.verify({ ...record, path: escape }), /escapes/);
  record.lease = { pid: process.pid };
  worktrees.save(record);
  const leased = (await inventory(second)).find((row) => row.path === good.path);
  assert.equal(leased.classification, 'blocked');
  assert.ok(leased.blockers.some((value) => value.includes('live Rex coordinator')));
  await assert.rejects(second.tools.get('worktree_remove').definition.execute('leased-cleanup', { target: good.path }, undefined, undefined, removalContext), /live Rex coordinator/);
  record.lease = null;
  worktrees.save(record);
  processBlockers = ['Live process fixture holds the checkout'];
  const held = (await inventory(second)).find((row) => row.path === good.path);
  assert.equal(held.classification, 'blocked');
  assert.ok(held.blockers.includes(processBlockers[0]));
  await assert.rejects(second.tools.get('worktree_remove').definition.execute('held-cleanup', { target: good.path }, undefined, undefined, removalContext), /Live process fixture/);
  processBlockers = [];
  const taskLog = join(fixture, 'task.jsonl');
  const coordinatorLog = join(fixture, 'coordinator.jsonl');
  const taskBytes = JSON.stringify({ type: 'session', id: 'fixture-task' }) + '\n';
  const coordinatorBytes = JSON.stringify({ type: 'session', id: 'fixture-coordinator' }) + '\n';
  writeFileSync(taskLog, taskBytes);
  const manifest = join(fixture, 'manifest.json');
  infrastructure.worktreeOperations.writeWorktreeManifest(manifest, { id: 'fixture-run', path: good.path, branch: good.branch, sourceCwd: repo, sessionFile: taskLog });
  removalContext.sessionManager = { ...ctx.sessionManager, getSessionFile: () => coordinatorLog };
  await assert.rejects(second.tools.get('worktree_remove').definition.execute('unarchived-cleanup', { target: good.path }, undefined, undefined, removalContext), /ENOENT/);
  assert.equal(existsSync(good.path), true);
  writeFileSync(coordinatorLog, coordinatorBytes);
  let removalCalls = 0;
  cleanupOperations.removeCheckout = async (source, path) => {
    assert.equal(source, repo);
    assert.equal(path, good.path);
    const history = await second.tools.get('rex_task_history').definition.execute('fixture-history', {}, undefined, undefined, ctx);
    assert.equal(history.details.entries.length, 1);
    assert.equal(readFileSync(history.details.entries[0].taskLog.archived, 'utf8'), taskBytes);
    assert.equal(readFileSync(history.details.entries[0].coordinatorLog.archived, 'utf8'), coordinatorBytes);
    renameSync(path, `${path}-retained`);
    removalCalls++;
  };
  cleanupOperations.prune = (source) => assert.equal(source, repo);
  const removed = await second.tools.get('worktree_remove').definition.execute('eligible-cleanup', { target: good.path }, undefined, undefined, removalContext);
  assert.equal(removed.details.status, 'removed');
  assert.equal(removalCalls, 1);
  assert.equal(existsSync(`${good.path}-retained`), true);
  assert.equal(git(repo, ['rev-parse', good.branch]).trim(), record.baseSha);
  assert.equal(worktrees.records().find((row) => row.path === good.path).removed, true);
  assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).state, 'removed');
  for (const handler of second.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
});
