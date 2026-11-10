import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { orphanResults, parseRequest, RequestInbox, requestState, REQUEST_TTL, submitRequest } from '../src/requests.ts';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'rex-requests-'));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  return { root: join(root, 'requests'), repo };
};
const request = (action, params, extra = {}) => ({ version: 1, id: '00000000-0000-4000-8000-000000000000', origin: '/coord', action, params, createdAt: Date.now(), ...extra });
const tasks = () => [{ id: 'task-1', logicalId: 'task-1', name: 'plt-4', originCwd: '/coord', sessionFile: '/s/plt-4.jsonl' }];

test('launch requests become a persistent interactive worktree agent and ignore extra parameters', () => {
  const { repo } = fixture();
  const parsed = parseRequest(request('launch', {
    name: 'plt-4', task: 'Goal: x', cwd: repo, worktree: { branch: 'jal/plt-4', base: 'origin/main' },
    persistent: false, interactive: false, model: 'other/model', tools: 'bash', agent: 'x',
  }));
  assert.deepEqual(parsed, {
    tool: 'subagent',
    params: { name: 'plt-4', task: 'Goal: x', cwd: repo, worktree: { branch: 'jal/plt-4', base: 'origin/main' }, persistent: true, interactive: true, model: 'task:coding', thinking: 'medium' },
  });
  assert.equal(parseRequest(request('launch', { name: 'dots', task: 'x', cwd: repo, worktree: null })).params.worktree, null);
  assert.throws(() => parseRequest(request('launch', { name: 'dots', task: 'x', cwd: repo })), /Invalid worktree/);
  assert.throws(() => parseRequest(request('launch', { name: 'plt-4', task: 'x', cwd: '/nope', worktree: { branch: 'b', base: 'origin/main' } })), /not a Git repository/);
  assert.throws(() => parseRequest(request('launch', { name: 'plt-4', task: 'x', cwd: repo, worktree: { branch: '--force', base: 'origin/main' } })), /Invalid worktree/);
  assert.throws(() => parseRequest(request('launch', { name: 'Bad Name', task: 'x', cwd: repo, worktree: { branch: 'b', base: 'm' } })), /Invalid task name/);
});

test('send, stop, resume and coordinator messages map to the coordinator; resume uses the retained session file', () => {
  assert.deepEqual(parseRequest(request('send', { id: 'task-1', message: 'rebase' })), { tool: 'subagent_send', params: { id: 'task-1', message: 'rebase' } });
  assert.throws(() => parseRequest(request('send', { id: 'task-1', message: ' ' })), /missing/);
  assert.deepEqual(parseRequest(request('stop', { id: 'task-1' })), { tool: 'subagent_stop', params: { id: 'task-1' } });
  assert.deepEqual(parseRequest(request('resume', { id: 'task-1' }), { tasks }), { tool: 'subagent_resume', params: { sessionPath: '/s/plt-4.jsonl', name: 'plt-4' } });
  assert.throws(() => parseRequest(request('resume', { id: 'task-1' }, { origin: '/other' }), { tasks }), /No retained task/);
  assert.deepEqual(parseRequest(request('message', { message: 'clean up plt-4' })), { tool: 'message', params: { message: 'clean up plt-4' } });
  assert.throws(() => parseRequest(request('message', { message: '' })), /missing/);
  assert.deepEqual(parseRequest(request('cleanup', { id: 'task-1', checkout: '/w/plt-4', preserve: 'yes' })), { tool: 'cleanup', params: { id: 'task-1', checkout: '/w/plt-4', preserve: false } });
  assert.equal(parseRequest(request('cleanup', { id: 'task-1', checkout: '/w/plt-4', preserve: true })).params.preserve, true);
  assert.throws(() => parseRequest(request('cleanup', { id: 'task-1', checkout: 'relative' })), /checkout path/);
  assert.deepEqual(parseRequest(request('retain', { url: 'https://github.com/mastra-ai/platform/pull/4495' })), { tool: 'retain', params: { url: 'https://github.com/mastra-ai/platform/pull/4495' } });
  assert.throws(() => parseRequest(request('retain', { url: 'https://evil.example/pull/1' })), /Invalid pull request URL/);
  assert.throws(() => parseRequest(request('shell', {})), /Unsupported/);
});

test('requests expire so a late coordinator never launches stale work', () => {
  assert.throws(() => parseRequest(request('stop', { id: 'task-1' }, { createdAt: Date.now() - REQUEST_TTL - 1 })), /expired/);
  assert.throws(() => parseRequest(request('stop', { id: 'task-1' }, { createdAt: undefined })), /expired/);
});

test('the inbox runs each request once for its own coordinator and returns the result to the caller', async () => {
  const { root } = fixture();
  const calls = [];
  const inbox = new RequestInbox({ root, origin: '/coord', tasks, run: async (tool, params) => { calls.push({ tool, params }); return { ok: true, text: `${tool} ok` }; } });
  const mine = submitRequest({ origin: '/coord', action: 'stop', params: { id: 'task-1' } }, root);
  const theirs = submitRequest({ origin: '/elsewhere', action: 'stop', params: { id: 'task-1' } }, root);
  const bad = submitRequest({ origin: '/coord', action: 'stop', params: { id: '../x' } }, root);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.deepEqual(requestState(mine, root), { state: 'queued' });
  await Promise.all([inbox.scan(), inbox.scan()]);
  assert.deepEqual(calls, [{ tool: 'subagent_stop', params: { id: 'task-1' } }]);
  assert.deepEqual(requestState(mine, root), { state: 'done', ok: true, text: 'subagent_stop ok' });
  assert.deepEqual(requestState(bad, root), { state: 'done', ok: false, text: 'Invalid task ID' });
  assert.deepEqual(requestState(theirs, root), { state: 'queued' });
  assert.ok(!existsSync(join(root, `${mine}.result.json`)));
  await inbox.close();
});

test('tool failures are reported as results and the claim is released', async () => {
  const { root } = fixture();
  const inbox = new RequestInbox({ root, origin: '/coord', run: async () => { throw new Error('Persistent specialist cap (8) reached'); } });
  const id = submitRequest({ origin: '/coord', action: 'send', params: { id: 'task-1', message: 'hi' } }, root);
  writeFileSync(join(root, 'not-a-request.txt'), 'x');
  await inbox.scan();
  assert.deepEqual(requestState(id, root), { state: 'done', ok: false, text: 'Persistent specialist cap (8) reached' });
  assert.deepEqual(readdirSync(root).sort(), ['not-a-request.txt']);
  await inbox.close();
});

test('requests are claimed on arrival, so a slow job ahead of them never expires them', async () => {
  const { root } = fixture();
  let clock = 0;
  let release;
  const started = new Promise((resolve) => { release = resolve; });
  let finishSlow;
  const order = [];
  const inbox = new RequestInbox({ root, origin: '/coord', now: () => clock, run: async (_tool, params) => {
    order.push(params.id);
    if (params.id === 'slow') { release(); await new Promise((resolve) => { finishSlow = resolve; }); }
    return { ok: true, text: params.id };
  } });
  const age = (id) => writeFileSync(join(root, `${id}.json`), JSON.stringify({ ...JSON.parse(readFileSync(join(root, `${id}.json`), 'utf8')), createdAt: 0 }));
  age(submitRequest({ origin: '/coord', action: 'stop', params: { id: 'slow' } }, root));
  inbox.scan();
  await started;
  const queued = submitRequest({ origin: '/coord', action: 'stop', params: { id: 'queued' } }, root);
  age(queued);
  inbox.scan();
  assert.deepEqual(requestState(queued, root), { state: 'running' });
  clock = REQUEST_TTL * 5;
  finishSlow();
  await inbox.busy;
  assert.deepEqual(order, ['slow', 'queued']);
  assert.deepEqual(requestState(queued, root), { state: 'done', ok: true, text: 'queued' });
  await inbox.close();
});

test('claimed work left when the coordinator closes is reported instead of silently dropped', async () => {
  const { root } = fixture();
  const inbox = new RequestInbox({ root, origin: '/coord', run: async () => ({ ok: true, text: 'ran' }) });
  const id = submitRequest({ origin: '/coord', action: 'stop', params: { id: 'task-1' } }, root);
  inbox.scan();
  await inbox.close();
  assert.deepEqual(requestState(id, root), { state: 'done', ok: false, text: 'The coordinator reloaded before running this request; nothing was done. Try again.' });
});

test('results nobody read are collected once for the next command center', async () => {
  const { root } = fixture();
  const inbox = new RequestInbox({ root, origin: '/coord', run: async () => ({ ok: true, text: 'Launched plt-9. More detail.' }) });
  submitRequest({ origin: '/coord', action: 'stop', params: { id: 'task-1' } }, root);
  await inbox.scan();
  assert.deepEqual(orphanResults(root), [{ state: 'done', ok: true, text: 'Launched plt-9. More detail.' }]);
  assert.deepEqual(orphanResults(root), []);
  assert.deepEqual(orphanResults(join(root, 'missing')), []);
  await inbox.close();
});

test('a request for work already queued or running is skipped as a duplicate, and allowed again once it finishes', async () => {
  const { root } = fixture();
  let finish;
  const started = [];
  const inbox = new RequestInbox({ root, origin: '/coord', tasks, run: async (tool, params) => {
    started.push(params.checkout ?? params.id);
    if (started.length === 1) await new Promise((resolve) => { finish = resolve; });
    return { ok: true, text: 'done' };
  } });
  const send = (params) => submitRequest({ origin: '/coord', action: 'cleanup', params }, root);
  const first = send({ id: 'task-1', checkout: '/w/a' });
  inbox.scan();
  const copies = [send({ id: 'task-1', checkout: '/w/a' }), send({ id: 'task-1', checkout: '/w/a' })];
  const other = send({ id: 'task-2', checkout: '/w/b' });
  inbox.scan();
  for (const id of copies) assert.deepEqual(requestState(id, root), { state: 'done', ok: true, outcome: 'duplicate', text: 'Already queued or running; this duplicate was skipped.' });
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
  finish();
  await inbox.busy;
  assert.deepEqual(started, ['/w/a', '/w/b']);
  assert.equal(requestState(first, root).text, 'done');
  assert.equal(requestState(other, root).text, 'done');
  const again = send({ id: 'task-1', checkout: '/w/a' });
  await inbox.scan();
  assert.equal(requestState(again, root).text, 'done');
  assert.deepEqual(started, ['/w/a', '/w/b', '/w/a']);
  await inbox.close();
});

test('the inbox still picks up requests after its file watcher dies', async () => {
  const { root } = fixture();
  const inbox = new RequestInbox({ root, origin: '/coord', run: async () => ({ ok: true, text: 'ran' }) });
  inbox.start();
  inbox.watcher.emit('error', new Error('EMFILE: too many open files, watch'));
  const id = submitRequest({ origin: '/coord', action: 'stop', params: { id: 'task-1' } }, root);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await inbox.busy;
  assert.deepEqual(requestState(id, root), { state: 'done', ok: true, text: 'ran' });
  await inbox.close();
});
