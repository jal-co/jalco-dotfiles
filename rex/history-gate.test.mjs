import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { infrastructureFor } from './runtime.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);

test('native worktree cleanup requires confirmation and valid transcript archives before removal', async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), 'rex-history-gate-'));
  const keys = ['REX_SESSION', 'HERDR_ENV', 'REX_HISTORY_ROOT', 'REX_TASK_ROOT', 'REX_PR_ROOT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { REX_SESSION: 'session:history-gate', REX_HISTORY_ROOT: join(fixture, 'history'), REX_TASK_ROOT: join(fixture, 'tasks'), REX_PR_ROOT: join(fixture, 'prs') });
  delete process.env.HERDR_ENV;
  const checkout = { path: join(fixture, 'checkout'), branch: 'test/history', repo: fixture,
    manifest: { value: { sessionFile: join(fixture, 'missing-child.jsonl'), id: 'fixture' } } };
  let removals = 0;
  let holderChecks = 0;
  const infrastructure = infrastructureFor(process.env.REX_SESSION, () => ({
    provider: { isAvailable: () => true },
    worktrees: { records: () => [checkout], exclusive: (fn) => fn(), verify() {}, assertUnused: async () => { holderChecks++; } },
    cleanupOperations: { scan() { removals++; throw new Error('Removal entered unexpectedly'); } },
    worktreeOperations: {}, supervision: { close() {} },
  }));
  const loaded = await loadExtensions([join(root, 'index.ts')], fixture);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const ctx = { hasUI: true, cwd: fixture, sessionManager: { getBranch: () => [], getSessionFile: () => join(fixture, 'parent.jsonl') }, ui: { confirm: async () => false, setWidget() {}, notify() {}, setStatus() {} } };
  context.after(async () => {
    for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const remove = () => extension.tools.get('worktree_remove').definition.execute('fixture', { target: checkout.path }, undefined, undefined, ctx);
  await assert.rejects(remove(), /not confirmed/);
  assert.equal(holderChecks, 0); assert.equal(removals, 0);
  ctx.ui.confirm = async () => true;
  writeFileSync(ctx.sessionManager.getSessionFile(), '{"type":"session","id":"coordinator"}\n');
  await assert.rejects(remove(), /ENOENT/);
  assert.equal(holderChecks, 1); assert.equal(removals, 0);
  infrastructure.worktrees.assertUnused = async () => { throw new Error('Live task process'); };
  await assert.rejects(remove(), /Live task process/);
  assert.equal(removals, 0);
});
