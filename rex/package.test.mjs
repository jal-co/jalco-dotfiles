import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

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
