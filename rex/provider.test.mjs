import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RexSurfaceProvider, surfaceTarget } from './provider.mjs';

const session = 'session:test-1';
const block = 'block:test-1';
const id = `${session}/${block}`;

function fixture() {
  const calls = [];
  const provider = new RexSurfaceProvider((args) => {
    calls.push(args);
    if (args[0] === 'new') return JSON.stringify({ session_id: session, initial_windows: [{ block_ids: [block] }] });
    if (args[0] === 'ls') return JSON.stringify({ sessions: [{ session_id: session }, { session_id: 'session:user' }] });
    if (args[0] === 'session') return JSON.stringify({ windows: [{ window_id: 'window:test', layers: [{ blocks: [{ block_id: block, label: 'task' }] }] }] });
    if (args[0] === 'capture') return 'first\nsecond\nthird';
    if (args[0] === 'block' && args[1] === 'call') return JSON.stringify({ child: { pid: 1 }, foreground: { pid: 2, name: 'zsh', argv0: '-zsh' } });
    return '{}';
  }, () => 2);
  return { provider, calls };
}

test('surface IDs require full session and block IDs', () => {
  assert.deepEqual(surfaceTarget(id), { session, block });
  for (const invalid of ['', block, `${id}/extra`, 'session:x/block:x;bad']) {
    assert.throws(() => surfaceTarget(invalid), /Invalid Rex surface/);
  }
});

test('each child creates a dedicated background session with an explicit cwd', () => {
  const { provider, calls } = fixture();
  assert.equal(provider.createSurface({ name: 'task', cwd: '/tmp/task' }), id);
  assert.deepEqual(calls[0], ['new', 'task', '-c', '/tmp/task', '--window', 'task', '--json']);
  assert.throws(() => provider.closeSurface('session:user/block:user'), /not owned/);
});

test('surface inventory never adopts unrelated sessions', async () => {
  const { provider, calls } = fixture();
  provider.createSurface({ name: 'task', cwd: '/tmp/task' });
  assert.equal((await provider.listSurfaces())[0].id, id);
  assert.equal(calls.some((args) => args.includes('session:user')), false);
  assert.equal((await provider.inspectSurface(id)).kind, 'present');
});

test('command submission is targeted and keeps command text separate from CLI options', () => {
  const { provider, calls } = fixture();
  provider.createSurface({ name: 'task', cwd: '/tmp/task' });
  provider.runCommand(id, '-dangerous option');
  assert.deepEqual(calls.at(-2), ['send', '-s', session, '-b', block, '--', '-dangerous option']);
  assert.deepEqual(calls.at(-1), ['send-key', '-s', session, '-b', block, 'enter']);
});

test('launch script paths are quoted and host banner comments are not copied', () => {
  const { provider, calls } = fixture();
  provider.createSurface({ name: 'task', cwd: '/tmp/task' });
  const directory = mkdtempSync(join(tmpdir(), 'rex-provider-test-'));
  const scriptPath = join(directory, "it's a task.sh");
  try {
    provider.runScript(id, 'printf ready', { scriptPath, scriptPreamble: '# generated banner' });
    assert.equal(readFileSync(scriptPath, 'utf8'), 'printf ready\n');
    assert.ok(calls.at(-2).at(-1).includes("it'\\''s a task.sh"));
  } finally {
    unlinkSync(scriptPath);
    rmdirSync(directory);
  }
});

test('reused terminals never expose completion markers from an earlier launch', async () => {
  const { provider } = fixture();
  provider.createSurface({ name: 'task', cwd: '/tmp/task' });
  const directory = mkdtempSync(join(tmpdir(), 'rex-boundary-test-'));
  const scriptPath = join(directory, 'task.sh');
  const call = provider.call;
  let screen = '__SUBAGENT_DONE_0__';
  provider.call = (args) => args[0] === 'capture' ? screen : call(args);
  try {
    provider.runScript(id, 'printf first', { scriptPath });
    assert.equal(await provider.readScreen(id), '');
    const first = provider.launchBoundaries.get(id);
    screen += `\n${first}\nfirst output\n__SUBAGENT_DONE_0__`;
    assert.match(await provider.readScreen(id), /first output/);
    provider.runScript(id, 'printf second', { scriptPath });
    assert.equal(await provider.readScreen(id), '');
    const second = provider.launchBoundaries.get(id);
    assert.notEqual(second, first);
    screen += `\n${second}\nsecond output`;
    assert.equal((await provider.readScreen(id)).trim(), 'second output');
    assert.doesNotMatch(await provider.readScreen(id), /__SUBAGENT_DONE_/);
    screen += '\n__SUBAGENT_DONE_0__';
    assert.match(await provider.readScreen(id), /__SUBAGENT_DONE_0__/);
  } finally {
    unlinkSync(scriptPath);
    rmdirSync(directory);
  }
});

test('unreachable Rex is unavailable, not evidence a child stopped', async () => {
  const provider = new RexSurfaceProvider(() => { throw new Error('server unreachable'); });
  assert.equal((await provider.inspectSurface(id)).kind, 'unavailable');
  await assert.rejects(provider.waitForSurfaceAbsence(id), /server unreachable/);
});

test('shell readiness and process inspection use the targeted terminal', async () => {
  const { provider } = fixture();
  provider.createSurface({ name: 'task', cwd: '/tmp/task' });
  await provider.waitForShellReady(id);
  assert.deepEqual((await provider.getProcessInfo(id)).pids, [1, 2]);
  assert.equal(await provider.readScreen(id, 2), 'second\nthird');
});

test('worktree operations fail closed when no manager is configured', () => {
  const { provider, calls } = fixture();
  assert.throws(() => provider.createWorktreeSurface(), /not configured/);
  assert.throws(() => provider.removeWorktreeSurface(), /not configured/);
  assert.equal(calls.length, 0);
});
