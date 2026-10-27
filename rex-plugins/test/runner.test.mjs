import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Manager } from '../src/manager.mjs';
import { Store, readJson, writeJson } from '../src/store.mjs';

const runner = fileURLToPath(new URL('../src/runner.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-runner-test-'));
  const store = new Store(join(root, 'state'));
  const manager = new Manager({ store, rex: { localServer: () => ({ instance: 'fixture', host: 'fixture' }), create: () => ({ session_id: 'session:fixture', initial_windows: [{ block_ids: ['block:fixture'] }] }) } });
  return { root, store, manager };
}

function launchRunner(f, row, t) {
  const child = spawn(process.execPath, [runner, '--root', f.store.root, row.id], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  return { child, output: () => ({ stdout, stderr }), closed: once(child, 'close') };
}

function waitForChild(store, id) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer); watcher.close();
      if (error) reject(error); else resolve();
    };
    const check = () => { if (readJson(store.file(id, 'runtime'))?.child) finish(); };
    const watcher = watch(store.directory(id), check);
    const timer = setTimeout(() => finish(new Error('Runner did not start')), 5000);
    watcher.on('error', finish);
    check();
  });
}

test('real runner records completion, status protocol and retained evidence', { timeout: 10000 }, async (t) => {
  const f = fixture();
  const row = f.manager.launch({ name: 'complete', adapter: 'command', argv: [process.execPath, '-e', 'console.log("fixture-success")'], cwd: f.root });
  const run = launchRunner(f, row, t);
  assert.equal((await run.closed)[0], 0);
  assert.equal(f.manager.status(row.id).state, 'completed');
  assert.match(run.output().stdout, /fixture-success/);
  assert.match(run.output().stdout, /7501;state=done/);
  assert.equal(f.store.request(row.id).id, row.id);
});

test('stop reaches only the owned child and confirms exit after runner shutdown', { timeout: 10000 }, async (t) => {
  const f = fixture();
  const row = f.manager.launch({ name: 'stop', adapter: 'command', argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: f.root });
  const ready = waitForChild(f.store, row.id);
  const run = launchRunner(f, row, t);
  await ready;
  assert.equal(f.manager.stop(row.id).state, 'stopping');
  await run.closed;
  assert.equal(f.manager.status(row.id).state, 'stopped');
  assert.equal(f.manager.status(row.id).runtime.signal, 'SIGTERM');
});

test('missing executable reports failed rather than leaving a permanent capacity slot', { timeout: 10000 }, async (t) => {
  const f = fixture();
  const row = f.manager.launch({ name: 'failure', adapter: 'command', argv: [join(f.root, 'missing-program')], cwd: f.root });
  const run = launchRunner(f, row, t);
  await run.closed;
  assert.equal(f.manager.status(row.id).state, 'failed');
  assert.match(f.manager.status(row.id).runtime.error, /ENOENT/);
});

test('a duplicate runner never spawns another child for the same run', { timeout: 10000 }, async (t) => {
  const f = fixture();
  const row = f.manager.launch({ name: 'duplicate', adapter: 'command', argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: f.root });
  const ready = waitForChild(f.store, row.id);
  const first = launchRunner(f, row, t);
  await ready;
  const pid = f.manager.status(row.id).runtime.child.pid;
  const second = launchRunner(f, row, t);
  assert.equal((await second.closed)[0], 1);
  assert.equal(f.manager.status(row.id).runtime.child.pid, pid);
  f.manager.stop(row.id);
  await first.closed;
});

test('Pi-style captured command output is durable without provider calls', { timeout: 10000 }, async (t) => {
  const f = fixture();
  const row = f.manager.launch({ name: 'capture', adapter: 'command', argv: [process.execPath, '-e', 'console.log("json-event"); console.error("diagnostic")'], cwd: f.root });
  const request = f.store.request(row.id);
  writeJson(f.store.file(row.id, 'request'), { ...request, command: { ...request.command, capture: true } });
  const run = launchRunner(f, row, t);
  await run.closed;
  assert.equal(f.manager.status(row.id).state, 'completed');
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(join(f.store.directory(row.id), 'stdout.log'), 'utf8'), /json-event/);
  assert.match(readFileSync(join(f.store.directory(row.id), 'stderr.log'), 'utf8'), /diagnostic/);
});
