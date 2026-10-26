import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { TaskStore } from './tasks.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readModules } from './module-config.mjs';
import { renderOverview } from './overview.mjs';
import taskStatus from '../pi/agent/extensions/rex-task.ts';

test('overview prioritizes blocked tasks and strips terminal control sequences', () => {
  const text = renderOverview([
    { name: 'running', state: 'working', surface: 'session:a/block:a', reason: 'bash' },
    { name: 'blocked\u001b]52;payload\u0007', state: 'blocked', surface: 'session:b/block:b', reason: 'Answer needed' },
  ]);
  assert.ok(text.indexOf('BLOCKED') < text.indexOf('WORKING'));
  assert.ok(!text.includes('\u001b') && !text.includes('\u0007'));
  assert.match(text, /Answer needed/);
  assert.match(renderOverview([]), /No tracked tasks/);
  assert.ok(renderOverview([{ name: 'x'.repeat(100), surface: 'session:a/block:a' }], 20).split('\n').slice(3).every((line) => line.length <= 20));
});

test('modules are independent, strict boolean switches', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rex-modules-'));
  const file = join(directory, 'modules.json');
  const previous = process.env.REX_MODULES_CONFIG;
  process.env.REX_MODULES_CONFIG = file;
  try {
    writeFileSync(file, '{"recovery":false,"overview":true}');
    assert.deepEqual(readModules(), { recovery: false, overview: true });
    writeFileSync(file, '{"recovery":true,"overview":false}');
    assert.deepEqual(readModules(), { recovery: true, overview: false });
    writeFileSync(file, '{"recovery":"yes","overview":true}');
    assert.throws(readModules);
  } finally { if (previous === undefined) delete process.env.REX_MODULES_CONFIG; else process.env.REX_MODULES_CONFIG = previous; }
});

test('overview updates from filesystem events and disabling it preserves task metadata', { timeout: 10000 }, async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rex-overview-events-'));
  const config = join(root, 'modules.json');
  writeFileSync(config, '{"recovery":false,"overview":true}');
  const store = new TaskStore(join(root, 'tasks'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./overview.mjs', import.meta.url))], { env: { ...process.env, REX_TASK_ROOT: store.root, REX_MODULES_CONFIG: config }, stdio: ['ignore', 'pipe', 'pipe'] });
  context.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const output = (pattern) => new Promise((resolve) => {
    let buffer = '';
    const listen = (chunk) => { buffer += chunk; if (pattern.test(buffer)) { child.stdout.removeListener('data', listen); resolve(buffer); } };
    child.stdout.on('data', listen);
  });
  await output(/No tracked tasks/);
  const changed = output(/Answer needed/);
  store.write({ version: 1, id: 'view-fixture', name: 'fixture', state: 'blocked', reason: 'Answer needed', surface: 'session:a/block:a', originCwd: root, sessionFile: join(root, 'session.jsonl'), activityFile: join(root, 'activity.json'), owner: { pid: process.pid } });
  assert.match(await changed, /BLOCKED/);
  const exited = once(child, 'exit');
  writeFileSync(config, '{"recovery":true,"overview":false}');
  assert.equal((await exited)[0], 0);
  assert.equal(store.read('view-fixture').reason, 'Answer needed');
});

test('native task indicators preserve labels and clear only their own status when disabled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rex-status-'));
  const config = join(directory, 'modules.json');
  writeFileSync(config, '{"recovery":false,"overview":true}');
  const sessionFile = join(directory, 'child.jsonl');
  writeFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, JSON.stringify({ generationId: 'g', policyHash: 'h' }));
  const keys = ['REX_SESSION', 'PI_SUBAGENT_ID', 'REX_MODULES_CONFIG', 'PI_SUBAGENT_SESSION', 'PI_SUBAGENT_SURFACE'];
  const previous = keys.map((key) => process.env[key]);
  Object.assign(process.env, { REX_SESSION: 'session:fixture', PI_SUBAGENT_ID: 'fixture', REX_MODULES_CONFIG: config, PI_SUBAGENT_SESSION: sessionFile, PI_SUBAGENT_SURFACE: 'session:fixture/block:fixture' });
  const callbacks = new Map();
  let output = '';
  const original = process.stdout.write;
  try {
    await taskStatus({ on: (name, handler) => callbacks.set(name, handler) });
    process.stdout.write = (text) => { output += text; return true; };
    callbacks.get('session_start')();
    assert.equal(JSON.parse(readFileSync(`${sessionFile}.rex-process.json`, 'utf8')).pid, process.pid);
    callbacks.get('agent_start')();
    callbacks.get('tool_execution_end')({ toolName: 'caller_ping' });
    callbacks.get('agent_settled')();
    assert.match(output, /state=working/); assert.match(output, /state=blocked/);
    assert.ok(!output.includes(']2;'));
    writeFileSync(config, '{"recovery":true,"overview":false}');
    callbacks.get('agent_start')();
    assert.match(output, /state=clear:id=rex-task/);
  } finally {
    process.stdout.write = original;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
