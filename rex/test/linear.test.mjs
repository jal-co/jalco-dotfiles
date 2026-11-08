import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildRows, capacityOf, issueBrief, issueQuery, launchParams, linkedTask, loadLinear, moveCursor,
  readLinearConfig, readToken, renderView, saveRepository, selectable,
} from '../src/linear.mjs';

const issue = (identifier, type, extra = {}) => ({
  identifier, title: `Title ${identifier}`, url: `https://linear.app/x/issue/${identifier}`, branchName: `jal/${identifier.toLowerCase()}-fix`,
  priority: 3, description: 'Do the thing', state: { name: type, type }, team: { key: identifier.split('-')[0] }, project: { name: 'Billing' }, ...extra,
});
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

test('the command center groups live tasks by project, shows PR state and hides stopped tasks until toggled', () => {
  const tasks = [
    task('ui-fix', 'working'),
    task('old-run', 'stopped', { stopConfirmed: true }),
    task('docs', 'blocked', { worktree: '/Users/j/.rex/worktrees/docs-0123456789ab/docs' }),
    task('direct', 'done', { worktree: undefined }),
  ];
  const prs = [{ taskId: 'ui-fix-id', url: 'https://github.com/a/b/pull/1', state: 'OPEN', checkedAt: '2026-11-08' }];
  const data = { tasks, prs, records: [{ path: tasks[0].worktree, repo: '/Users/j/platform' }], linear: { status: 'missing', message: 'none', open: [], done: [] } };
  const rows = buildRows(2, data);
  const text = rows.map((row) => row.text).join('\n');
  assert.deepEqual(rows.filter((row) => row.kind === 'header').map((row) => row.text), ['docs', 'No checkout', 'platform']);
  assert.match(text, /● working\s+ui-fix\s+PR open/);
  assert.match(text, /! blocked\s+docs/);
  assert.doesNotMatch(text, /old-run/);
  assert.match(text, /1 stopped task hidden/);
  assert.match(buildRows(2, data, { showStopped: true }).map((row) => row.text).join('\n'), /– stopped\s+old-run/);
});

test('issue tabs show empty states, split started from todo and mark issues that already have agents', () => {
  const empty = { tasks: [], prs: [], records: [], linear: { status: 'missing', message: 'No Linear token configured.', open: [], done: [] } };
  assert.deepEqual(buildRows(0, empty).map((row) => row.text.trim()), ['No Linear token configured.']);
  const open = [issue('PLT-2', 'unstarted', { priority: 1 }), issue('PLT-1', 'started'), issue('PLT-3', 'backlog')];
  const data = { ...empty, tasks: [task('plt-1', 'working', { branch: 'jal/plt-1-fix' })], linear: { status: 'ok', open, done: [] } };
  const rows = buildRows(0, data);
  assert.deepEqual(rows.filter((row) => row.kind === 'header').map((row) => row.text), ['In progress', 'Todo']);
  assert.match(rows.find((row) => row.item?.identifier === 'PLT-1').text, /● /);
  assert.match(rows.find((row) => row.item?.identifier === 'PLT-2').text, /!! PLT-2/);
  assert.deepEqual(buildRows(1, data).filter(selectable).map((row) => row.item.identifier), ['PLT-3']);
});

test('today separates in-progress work, up-next issues and work finished since midnight', () => {
  const now = new Date('2026-11-08T15:00:00').getTime();
  const tasks = [task('active', 'working'), task('shipped', 'done', { updatedAt: now - 1000 }), task('yesterday', 'done', { updatedAt: now - 86_400_000 })];
  const linear = { status: 'ok', open: [issue('PLT-9', 'unstarted'), issue('PLT-8', 'started')], done: [issue('PLT-7', 'completed')] };
  const rows = buildRows(3, { tasks, prs: [], records: [], linear }, { now });
  const sections = {};
  let current;
  for (const row of rows) {
    if (row.kind === 'header') current = sections[row.text] = [];
    else if (selectable(row)) current.push(row.item.name ?? row.item.identifier);
  }
  assert.deepEqual(sections, { 'In progress': ['active', 'PLT-8'], 'Up next': ['PLT-9'], 'Done today': ['shipped', 'PLT-7'] });
});

test('cursor skips headers and the render fits its width without control sequences', () => {
  const rows = [{ kind: 'header', text: 'g' }, { kind: 'task', text: 'a', item: {} }, { kind: 'note', text: '' }, { kind: 'issue', text: 'b', item: {} }];
  assert.equal(moveCursor(rows, -1, 0), 1);
  assert.equal(moveCursor(rows, 1, 1), 3);
  assert.equal(moveCursor(rows, 3, 1), 3);
  assert.equal(moveCursor([{ kind: 'header' }], -1, 1), -1);
  const lines = renderView({ tab: 2, rows: [{ kind: 'task', text: `x\u001b]52;payload\u0007${'y'.repeat(200)}`, tone: 'text' }], cursor: 0, status: { tone: 'error', text: 'boom' }, capacity: { used: 8, max: 8 }, counts: [1, 2, 3, undefined] }, 40, 20);
  assert.ok(lines.every((line) => [...line.text].length <= 40 && !/[\u001b\u0007]/.test(line.text)));
  assert.equal(lines.length, 20);
  assert.ok(lines.some((line) => line.selected));
  assert.match(renderView({ tab: 2, rows: [], cursor: -1, capacity: { used: 8, max: 8 }, counts: [1, 2, 3, undefined] }, 120, 12)[0].text, /\[3 Sessions 3\] +4 Today\s+agents 8\/8$/);
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
