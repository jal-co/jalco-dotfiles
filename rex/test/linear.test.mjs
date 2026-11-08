import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildView, capacityOf, issueBrief, issueQuery, launchParams, linkedTask, loadLinear, moveCursor,
  readLinearConfig, readToken, saveRepository,
} from '../src/linear.mjs';
import { columns, fit, keys, renderScreen } from '../src/linear-tui.mjs';

const issue = (identifier, type, extra = {}) => ({
  identifier, title: `Title ${identifier}`, url: `https://linear.app/x/issue/${identifier}`, branchName: `jal/${identifier.toLowerCase()}-fix`,
  priority: 3, description: 'Do the thing', state: { name: type, type }, team: { key: identifier.split('-')[0] }, project: { name: 'Billing' }, ...extra,
});
const items = (rows) => rows.filter((row) => row.kind === 'item');
const sections = (rows) => {
  const out = {};
  let current;
  for (const row of rows) {
    if (row.kind === 'section') current = out[row.title] = [];
    else if (row.kind === 'item') current.push(row.id);
  }
  return out;
};
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
const task = (name, state, extra = {}) => ({
  id: `${name}-id`, name, state, surface: 'session:a/block:b', originCwd: '/coord', persistent: true,
  branch: `jal/${name}`, worktree: `/Users/j/.rex/worktrees/platform-726f824a9a36/${name}`, updatedAt: Date.now(), ...extra,
});

test('config accepts only op references and absolute repository paths, and saves team mappings privately', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rex-linear-'));
  const file = join(directory, 'linear.json');
  assert.deepEqual(readLinearConfig(file), { repositories: {} });
  writeFileSync(file, '{"tokenRef":"lin_api_secret"}');
  assert.throws(() => readLinearConfig(file), /op:\/\/ reference/);
  writeFileSync(file, '{"tokenRef":"op://vault/item/credential","repositories":{"PLT":"relative"}}');
  assert.throws(() => readLinearConfig(file), /absolute paths/);
  writeFileSync(file, '{"tokenRef":"op://vault/item/credential"}');
  saveRepository('PLT', '/Users/j/platform', file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { tokenRef: 'op://vault/item/credential', repositories: { PLT: '/Users/j/platform' } });
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('token reads never surface the secret or raw op output, and missing configuration is an empty state', async () => {
  const leaked = await readToken('op://v/i/f', async () => { throw Object.assign(new Error('lin_api_secret in stderr'), { stderr: 'lin_api_secret' }); }).catch((error) => error.message);
  assert.equal(leaked, 'op read failed for op://v/i/f');
  assert.equal(await readToken('op://v/i/f', async () => ({ stdout: 'lin_api_abc\n' })), 'lin_api_abc');
  const missing = await loadLinear({ config: { repositories: {} } });
  assert.equal(missing.status, 'missing');
  assert.match(missing.message, /tokenRef/);
  const failed = await loadLinear({ config: { tokenRef: 'op://v/i/f', repositories: {} }, read: async () => { throw new Error('no'); } });
  assert.equal(failed.status, 'error');
  assert.doesNotMatch(JSON.stringify(failed), /lin_api/);
});

test('Linear issues load through GraphQL with the personal key and report API errors', async () => {
  let request;
  const fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { open: { nodes: [issue('PLT-1', 'started')] }, done: { nodes: [] } } } }) };
  };
  const loaded = await loadLinear({ config: {}, token: 'lin_api_abc', fetch });
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.open[0].identifier, 'PLT-1');
  assert.equal(request.url, 'https://api.linear.app/graphql');
  assert.equal(request.init.headers.authorization, 'lin_api_abc');
  const failed = await loadLinear({ config: {}, token: 'oauth', fetch: async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ errors: [{ message: 'Authentication required' }] }) }) });
  assert.equal(failed.status, 'error');
  assert.match(failed.message, /401: Authentication required/);
  assert.match(issueQuery(new Date('2026-11-08T05:00:00.000Z')), /completedAt: \{ gte: "2026-11-08T05:00:00.000Z" \}/);
});

test('linked tasks match the issue branch exactly or by identifier boundary', () => {
  const tasks = [task('pltfrm-305', 'working', { branch: 'jal/pltfrm-305-other' }), task('pltfrm-3055', 'done', { branch: 'jal/pltfrm-3055-label' })];
  assert.equal(linkedTask(issue('PLTFRM-3055', 'started', { branchName: 'unrelated' }), tasks).name, 'pltfrm-3055');
  assert.equal(linkedTask(issue('PLTFRM-30', 'started', { branchName: 'unrelated' }), tasks), undefined);
});

test('sessions group live tasks by repository with agent and PR labels, hiding stopped tasks until toggled', () => {
  const tasks = [
    task('ui-fix', 'working'),
    task('old-run', 'stopped', { stopConfirmed: true }),
    task('docs', 'blocked', { worktree: '/Users/j/.rex/worktrees/docs-0123456789ab/docs' }),
    task('shipped', 'done', { worktree: '/Users/j/.rex/worktrees/platform-726f824a9a36/shipped' }),
  ];
  const prs = [{ taskId: 'shipped-id', url: 'https://github.com/a/b/pull/7', state: 'MERGED', checkedAt: '2026-11-08' }];
  const data = { tasks, prs, records: [{ path: tasks[0].worktree, repo: '/Users/j/platform' }], linear: { status: 'missing', message: 'none', open: [], done: [] } };
  const rows = buildView(2, data);
  assert.deepEqual(sections(rows), { docs: ['docs'], platform: ['ui-fix', 'shipped'] });
  assert.deepEqual(items(rows).map((row) => row.agent.text), ['! blocked', '● working', 'merged']);
  assert.match(rows.at(-1).text, /1 stopped task hidden/);
  assert.ok(items(buildView(2, data, { showStopped: true })).some((row) => row.id === 'old-run'));
  assert.equal(buildView(2, { ...data, tasks: [task('merged', 'stopped', { stopConfirmed: true, id: 'shipped-id' })] }, { showStopped: true })[1].agent.text, 'merged');
});

test('issue tabs show the empty state, split started from todo and label issues with their agent', () => {
  const empty = { tasks: [], prs: [], records: [], linear: { status: 'missing', message: 'No Linear token configured.\nAdd it.', open: [], done: [] } };
  assert.deepEqual(buildView(0, empty).map((row) => row.text), ['No Linear token configured.', 'Add it.']);
  const open = [issue('PLT-2', 'unstarted', { priority: 1 }), issue('PLT-1', 'started'), issue('PLT-3', 'backlog')];
  const data = { ...empty, tasks: [task('plt-1', 'working', { branch: 'jal/plt-1-fix' })], linear: { status: 'ok', open, done: [] } };
  assert.deepEqual(sections(buildView(0, data)), { 'In progress': ['PLT-1'], Todo: ['PLT-2'] });
  assert.equal(items(buildView(0, data))[0].agent.text, '● working');
  assert.deepEqual(sections(buildView(1, data)), { Billing: ['PLT-3'] });
});

test('the brief separates in progress, up next and done since yesterday without duplicates', () => {
  const now = new Date('2026-11-08T15:00:00').getTime();
  const tasks = [
    task('active', 'working'),
    task('plt-8', 'working', { branch: 'jal/plt-8-fix' }),
    task('shipped', 'done', { updatedAt: now - 1000 }),
    task('yesterday', 'done', { updatedAt: now - 86_400_000 }),
    task('old', 'done', { updatedAt: now - 3 * 86_400_000 }),
  ];
  const prs = [
    { taskId: 'shipped-id', url: 'https://github.com/a/b/pull/1', state: 'MERGED', mergedAt: new Date(now).toISOString(), name: 'shipped', repositoryPath: '/r/platform' },
    { taskId: 'gone', url: 'https://github.com/a/b/pull/2', state: 'MERGED', mergedAt: new Date(now).toISOString(), name: 'fix build', repositoryPath: '/r/harbor' },
  ];
  const linear = { status: 'ok', open: [issue('PLT-9', 'unstarted'), issue('PLT-8', 'started')], done: [issue('PLT-7', 'completed')] };
  const data = { tasks, prs, records: [], linear };
  assert.deepEqual(sections(buildView(3, data, { now })), {
    'In progress': ['active', 'PLT-8'],
    'Up next': ['PLT-9'],
    'Done since yesterday': ['PLT-7', 'shipped', 'yesterday', '#2'],
  });
  assert.deepEqual(items(buildView(3, data, { now, mode: 'list' })).map((row) => row.id), ['active', 'PLT-8', 'PLT-9', 'PLT-7', 'shipped', 'yesterday', '#2']);
  assert.equal(items(buildView(3, data, { now })).find((row) => row.id === 'shipped').agent.text, 'merged');
});

test('cursor skips headers, notes and blanks', () => {
  const rows = [{ kind: 'section' }, { kind: 'item' }, { kind: 'blank' }, { kind: 'note' }, { kind: 'item' }];
  assert.equal(moveCursor(rows, -1, 0), 1);
  assert.equal(moveCursor(rows, 1, 1), 4);
  assert.equal(moveCursor(rows, 4, 10), 4);
  assert.equal(moveCursor([{ kind: 'section' }], -1, 1), -1);
});

test('the screen fills the terminal exactly, measures wide characters and strips control sequences', () => {
  assert.equal(columns('ab🙂漢'), 6);
  assert.equal(fit('漢字漢字', 5), '漢字…');
  assert.equal(columns(fit('x\u001b]52;payload\u0007yz', 8)), 8);
  const rows = [
    { kind: 'section', title: 'In progress', count: 1 },
    { kind: 'item', key: 'i:A-1', id: 'A-1', title: `Title 🙂 ${'y'.repeat(200)}`, project: 'Billing', agent: { text: '● working', tone: 'yellow' } },
  ];
  const state = { tab: 3, mode: 'brief', rows, cursor: 1, working: 1, capacity: { used: 8, max: 8 }, doneCount: 2, now: Date.now() };
  for (const width of [40, 80, 140]) {
    const screen = renderScreen(state, width, 24).map(plain);
    assert.equal(screen.length, 24);
    assert.ok(screen.every((line) => columns(line) === width && !/[\u0000-\u001f\u007f]/.test(line)), String(width));
  }
  const screen = renderScreen(state, 120, 24).map(plain);
  assert.match(screen[0], /^1 Issues {3}2 Backlog {3}3 Sessions {3}4 Today +● 1 working {3}agents 8\/8$/);
  assert.match(screen[2], /^Brief {2}List/);
  assert.match(screen[5], /^ {2}In progress 1/);
  assert.match(screen[6], /^› A-1 +Title 🙂 y+…  Billing +● working/);
  assert.match(screen.at(-4), /^Title/);
  assert.match(screen.at(-1), /s send · u resume · d retire/);
  const retire = renderScreen({ ...state, confirm: { retire: true, task: task('ui-fix', 'unknown', { reason: 'Agent exited' }) } }, 100, 24).map(plain);
  assert.match(retire.at(-4), /^Retire ui-fix\?/);
  assert.match(retire.at(-2), /Logs, branch and checkout are kept/);
});

test('raw input splits into keys, including escape sequences and pasted text', () => {
  assert.deepEqual(keys('\u001b[Ajk\r\u001b[Z\u001b'), ['\u001b[A', 'j', 'k', '\r', '\u001b[Z', '\u001b']);
});

test('issue launches use the coordinator brief template and a persistent interactive worktree agent', () => {
  const item = issue('PLT-4', 'unstarted', { description: 'Line one\n\u001b[31mred\u001b[0m' });
  const brief = issueBrief(item, 'jal/plt-4-fix');
  for (const part of ['Goal: Resolve PLT-4', 'Files:', 'Verification:', 'Commit: Commit on jal/plt-4-fix', 'Report:']) assert.ok(brief.includes(part), part);
  assert.doesNotMatch(brief, /\u001b/);
  assert.match(brief, /Line one\n/);
  assert.deepEqual(launchParams(item, { repo: '/r', base: 'origin/main', brief }), {
    name: 'plt-4', task: brief, cwd: '/r', worktree: { branch: 'jal/plt-4-fix', base: 'origin/main' },
    persistent: true, interactive: true, model: 'task:coding', thinking: 'medium',
  });
});

test('capacity counts retained persistent agents and live host agents once', () => {
  const tasks = [task('a', 'working'), task('b', 'stopped', { stopConfirmed: true }), task('c', 'done', { originCwd: '/other' })];
  assert.deepEqual(capacityOf(tasks, '/coord', [{ id: 'a-id', persistent: true }, { id: 'new', persistent: true }, { id: 'x' }], 8), { used: 2, max: 8 });
});
