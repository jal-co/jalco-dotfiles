import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildView, capacityOf, checkoutOf, findIssues, hiddenView, inbox, withoutHidden, issueBrief, issueQuery, issueReference, launchParams, linkedTask, loadLinear, moveCursor,
  readLinearConfig, readToken, saveRepository, slugFor, taskBrief,
} from '../src/linear.mjs';
import { confident, githubRepository, rankRepositories, terms } from '../src/repositories.mjs';
import { columns, fit, keys, readPreferences, renderScreen, writePreferences } from '../src/linear-tui.mjs';

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
  const rows = buildView(3, data);
  assert.deepEqual(sections(rows), { docs: ['docs'], platform: ['ui-fix', 'shipped'] });
  assert.deepEqual(items(rows).map((row) => row.agent.text), ['! blocked', '● working', 'merged']);
  assert.match(rows.at(-1).text, /1 stopped task hidden/);
  assert.ok(items(buildView(3, data, { showStopped: true })).some((row) => row.id === 'old-run'));
  assert.equal(buildView(3, { ...data, tasks: [task('merged', 'stopped', { stopConfirmed: true, id: 'shipped-id' })] }, { showStopped: true })[1].agent.text, 'merged');
});

test('issue tabs show the empty state, split started from todo and label issues with their agent', () => {
  const empty = { tasks: [], prs: [], records: [], linear: { status: 'missing', message: 'No Linear token configured.\nAdd it.', open: [], done: [] } };
  assert.deepEqual(buildView(1, empty).map((row) => row.text), ['No Linear token configured.', 'Add it.']);
  const open = [issue('PLT-2', 'unstarted', { priority: 1 }), issue('PLT-1', 'started'), issue('PLT-3', 'backlog')];
  const data = { ...empty, tasks: [task('plt-1', 'working', { branch: 'jal/plt-1-fix' })], linear: { status: 'ok', open, done: [] } };
  assert.deepEqual(sections(buildView(1, data)), { 'In progress': ['PLT-1'], Todo: ['PLT-2'] });
  assert.equal(items(buildView(1, data))[0].agent.text, '● working');
  assert.deepEqual(sections(buildView(2, data)), { Billing: ['PLT-3'] });
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
  assert.deepEqual(sections(buildView(4, data, { now })), {
    'In progress': ['active', 'PLT-8'],
    'Up next': ['PLT-9'],
    'Done since yesterday': ['PLT-7', 'shipped', 'yesterday', '#2'],
  });
  assert.deepEqual(items(buildView(4, data, { now, mode: 'list' })).map((row) => row.id), ['active', 'PLT-8', 'PLT-9', 'PLT-7', 'shipped', 'yesterday', '#2']);
  assert.equal(items(buildView(4, data, { now })).find((row) => row.id === 'shipped').agent.text, 'merged');
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
  const state = { tab: 4, mode: 'brief', inboxCount: 3, rows, cursor: 1, working: 1, capacity: { used: 8, max: 8 }, doneCount: 2, now: Date.now() };
  for (const width of [40, 80, 140]) {
    const screen = renderScreen(state, width, 24).map(plain);
    assert.equal(screen.length, 24);
    assert.ok(screen.every((line) => columns(line) === width && !/[\u0000-\u001f\u007f]/.test(line)), String(width));
  }
  const screen = renderScreen(state, 120, 24).map(plain);
  assert.match(screen[0], /^1 Inbox 3 {3}2 Issues {3}3 Backlog {3}4 Sessions {3}5 Today +● 1 working {3}agents 8\/8$/);
  assert.match(plain(renderScreen({ ...state, tab: 5, search: { query: 'x' } }, 140, 24)[0]), /5 Today {3}6 Search/);
  assert.match(screen[2], /^Brief {2}List/);
  assert.match(screen[5], /^ {2}In progress 1/);
  assert.match(screen[6], /^› A-1 +Title 🙂 y+…  Billing +● working/);
  assert.match(screen.at(-5), /^Title/);
  assert.match(screen.at(-1), /^\? all keys · enter open · n new · \/ search · c coordinator · s send · D clean up · d retire · u resume · h hide +$/);
  assert.match(renderScreen(state, 200, 24).map(plain).at(-1), /· H hidden · o link · r refresh · q quit +$/);
  assert.match(renderScreen(state, 60, 24).map(plain).at(-1), /^\? all keys · enter open · n new · \/ search · c coordinator +$/);
  const help = renderScreen({ ...state, help: true }, 100, 24).map(plain);
  assert.equal(help.length, 24);
  assert.ok(help.some((row) => /q  ctrl\+c +quit/.test(row)));
  assert.ok(help.some((row) => /esc +cancel; never quits/.test(row)));
  assert.ok(renderScreen({ ...state, help: true }, 100, 40).map(plain).some((row) => /^ {2}q  ctrl\+c +quit/.test(row)));
  assert.ok(help.some((row) => /esc +cancel; never quits/.test(row)));
  assert.match(help.at(-1), /^any key close this list/);
  assert.match(renderScreen({ ...state, prompt: { label: 'search', value: 'x' } }, 100, 24).map(plain).at(-1), /^enter submit · esc cancel/);
  const retire = renderScreen({ ...state, confirm: { kind: 'retire', task: task('ui-fix', 'unknown', { reason: 'Agent exited' }) } }, 100, 24).map(plain);
  assert.match(retire.at(-5), /^Retire ui-fix\?/);
  assert.match(retire.at(-3), /Logs, branch and checkout are kept/);
  assert.match(retire.at(-1), /^enter confirm · esc cancel/);
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

test('the inbox collects questions, failures, finished work and merged PRs waiting on cleanup, once each', () => {
  const tasks = [
    task('asks', 'blocked', { reason: 'Which plan?' }),
    task('crashed', 'unknown'),
    task('finished', 'done'),
    task('in-review', 'done'),
    task('merged', 'done'),
    task('busy', 'working'),
    task('gone', 'stopped', { stopConfirmed: true }),
  ];
  const prs = [
    { taskId: 'in-review-id', url: 'https://github.com/a/b/pull/1', state: 'OPEN', cleanup: 'pending', checkedAt: '1' },
    { taskId: 'merged-id', url: 'https://github.com/a/b/pull/2', state: 'MERGED', cleanup: 'pending', mergedAt: '2026-11-08', checkedAt: '1' },
    { taskId: 'gone-id', url: 'https://github.com/a/b/pull/3', state: 'MERGED', cleanup: 'pending', mergedAt: '2026-11-07', name: 'gone', repositoryPath: '/r/platform', checkedAt: '1' },
    { taskId: 'old', url: 'https://github.com/a/b/pull/4', state: 'MERGED', cleanup: 'removed', mergedAt: '2026-11-01', checkedAt: '1' },
  ];
  const data = { tasks, prs, records: [], linear: { status: 'ok', open: [], done: [] } };
  const result = inbox(data);
  assert.equal(result.count, 5);
  assert.deepEqual(sections(buildView(0, data)), {
    'Needs an answer': ['asks'], 'Failed or crashed': ['crashed'], 'Ready for review': ['finished'], 'Merged, cleanup pending': ['merged', 'gone'],
  });
  assert.match(result.merged[0].hint, /^D clean up · a clean up all merged/);
  assert.deepEqual(buildView(0, { ...data, tasks: [], prs: [] }).map((row) => row.text), ['Nothing needs you right now.']);
});

test('search results render in their own tab', () => {
  const data = { tasks: [], prs: [], records: [], linear: { status: 'ok', open: [], done: [] } };
  assert.deepEqual(sections(buildView(5, data, { search: { query: 'storage', issues: [issue('ENG-10', 'backlog')] } })), { 'Results for “storage”': ['ENG-10'] });
  assert.equal(buildView(5, data, { search: { query: 'x', status: 'Searching Linear…' } })[0].text, 'Searching Linear…');
  assert.match(buildView(5, data, { search: { query: 'zzz', issues: [] } })[0].text, /No issues match/);
});

test('pasted Linear links and identifiers resolve to one issue; other text searches', async () => {
  assert.equal(issueReference('https://linear.app/kepler/issue/ENG-10/storage-usage-bar'), 'ENG-10');
  assert.equal(issueReference('take pltfrm-3245 please'), 'PLTFRM-3245');
  assert.equal(issueReference('storage usage bar'), undefined);
  const calls = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.variables);
    const data = body.variables.id ? { issue: body.variables.id === 'ENG-10' ? issue('ENG-10', 'backlog') : null } : { searchIssues: { nodes: [issue('ENG-11', 'backlog')] } };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  assert.deepEqual((await findIssues('lin_api_x', 'https://linear.app/k/issue/ENG-10/x', fetch)).map((row) => row.identifier), ['ENG-10']);
  assert.deepEqual(await findIssues('lin_api_x', 'ENG-99', fetch), []);
  assert.deepEqual((await findIssues('lin_api_x', 'storage', fetch)).map((row) => row.identifier), ['ENG-11']);
  assert.deepEqual(calls, [{ id: 'ENG-10' }, { id: 'ENG-99' }, { term: 'storage' }]);
});

test('free-form tasks get a unique slug, branch and a brief without Linear rules', () => {
  assert.equal(slugFor('Add a keyboard shortcut to the TUI!'), 'add-keyboard-shortcut-tui');
  assert.equal(launchParams({ name: 'x' }, { repo: join(homedir(), 'dotfiles'), base: 'origin/main', brief: 'b' }).worktree, null);
  assert.equal(slugFor('Fix the build', ['fix-build', 'fix-build-2']), 'fix-build-3');
  assert.equal(slugFor('!!!'), 'task');
  assert.equal(slugFor('Add a coordinator shortcut to the rex-linear TUI'), 'add-coordinator-shortcut-rex');
  const subject = { title: 'Fix the build', name: 'fix-the-build', branchName: 'jal/fix-the-build' };
  assert.deepEqual(launchParams(subject, { repo: '/r', base: 'origin/main', brief: 'b' }).worktree, { branch: 'jal/fix-the-build', base: 'origin/main' });
  const brief = taskBrief({ goal: 'Fix the build', branch: 'jal/fix-the-build' });
  assert.match(brief, /^Goal: Fix the build/);
  assert.match(brief, /Do not push or open a PR\./);
  assert.doesNotMatch(brief, /Linear/);
});

test('repository ranking prefers linked PRs, then team history, then distinctive text, and explains why', async () => {
  const remotes = { '/r/platform': 'https://github.com/mastra-ai/platform.git', '/r/mastra': 'git@github.com:mastra-ai/mastra.git', '/r/norem': '' };
  const code = { '/r/platform': ['billing page', 'storage usage'], '/r/mastra': ['storage usage'] };
  const exec = async (_cmd, args) => {
    const repo = args[1];
    if (args[2] === 'remote') { if (!remotes[repo]) throw new Error('no remote'); return { stdout: remotes[repo] }; }
    if ((code[repo] ?? []).includes(args.at(-1).toLowerCase())) return { stdout: '' };
    throw new Error('no match');
  };
  const candidates = ['/r/platform', '/r/mastra', '/r/norem'];
  const subject = { identifier: 'ENG-10', title: 'Storage usage bar on the Starter plan', description: 'The Billing page is wrong', team: { key: 'ENG' } };
  const text = await rankRepositories(subject, { candidates, exec });
  assert.deepEqual(text.map((row) => row.name), ['platform', 'mastra']);
  assert.match(text[0].reasons.join(), /mentions “billing page”/);
  const linked = await rankRepositories({ ...subject, attachments: { nodes: [{ url: 'https://github.com/mastra-ai/mastra/pull/9' }] } }, { candidates, exec });
  assert.equal(linked[0].name, 'mastra');
  assert.match(linked[0].reasons[0], /1 linked PR here/);
  assert.ok(confident(linked));
  const learned = await rankRepositories(subject, { candidates, exec, config: { repositories: { ENG: '/r/mastra' } } });
  assert.equal(learned[0].name, 'mastra');
  assert.match(learned[0].reasons[0], /you picked it for ENG before/);
  const history = await rankRepositories({ title: 'Something new', team: { key: 'PLT' } }, {
    candidates, exec, tasks: [task('a', 'done', { branch: 'jal/plt-1-x', worktree: '/w/a' }), task('b', 'done', { branch: 'jal/plt-2-y', worktree: '/w/b' })],
    records: [{ path: '/w/a', repo: '/r/platform' }, { path: '/w/b', repo: '/r/platform' }],
  });
  assert.equal(history[0].name, 'platform');
  assert.match(history[0].reasons[0], /2 PLT tasks/);
  assert.equal(githubRepository('git@github.com:Mastra-AI/Platform.git'), 'mastra-ai/platform');
  assert.deepEqual(terms({ title: 'Fix the rex-linear TUI', description: 'Call `loadLinear()` early. ![x](https://a.b/c.png)' }).map((term) => [term.text, term.weight]),
    [['loadLinear()', 2], ['rex-linear', 2], ['rex-linear tui', 1], ['call loadlinear', 0.5], ['loadlinear early', 0.5]]);
});

test('hidden rows leave every tab, empty sections collapse, and the Hidden menu lists them', () => {
  const tasks = [task('keep', 'blocked'), task('noise', 'blocked'), task('crashed', 'unknown')];
  const data = { tasks, prs: [], records: [], linear: { status: 'ok', open: [], done: [] } };
  const hidden = new Set(['t:noise-id', 't:crashed-id']);
  const rows = withoutHidden(buildView(0, data), hidden);
  assert.deepEqual(sections(rows), { 'Needs an answer': ['keep'] });
  assert.equal(rows.find((row) => row.kind === 'section').count, 1);
  assert.notEqual(rows[0].kind, 'blank');
  assert.ok(rows.every((row, index) => row.kind !== 'blank' || rows[index - 1]?.kind !== 'blank'));
  assert.deepEqual(sections(hiddenView(data, hidden)), { Hidden: ['noise', 'crashed'] });
  assert.match(hiddenView(data, new Set()).find((row) => row.kind === 'note').text, /Nothing hidden/);
});

test('hidden keys persist privately and a missing file means nothing is hidden', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'rex-prefs-')), 'nested', 'command-center.json');
  assert.deepEqual(readPreferences(file), { hidden: [] });
  writePreferences({ hidden: ['t:a', 'p:https://x'] }, file);
  assert.deepEqual(readPreferences(file), { hidden: ['t:a', 'p:https://x'] });
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('cleanup confirmation says what happens and the key bar offers preserving uncommitted work', () => {
  const item = { kind: 'item', key: 't:a', id: 'a', title: 'A', project: 'p', agent: { text: '', tone: 'dim' }, task: task('ds-inputs', 'done') };
  assert.equal(checkoutOf(item), item.task.worktree);
  assert.equal(checkoutOf({ pr: { checkout: '/w/x' } }), '/w/x');
  const state = { tab: 0, rows: [item], cursor: 0, working: 0, capacity: { used: 1, max: 8 }, doneCount: 0, now: Date.now() };
  const one = renderScreen({ ...state, confirm: { kind: 'cleanup', items: [item] } }, 160, 24).map(plain);
  assert.match(one.at(-5), /^Clean up ds-inputs\?/);
  assert.ok(one.at(-4).includes(item.task.worktree));
  assert.match(one.at(-1), /^enter clean up · p keep uncommitted work as a commit · esc cancel/);
  assert.match(renderScreen({ ...state, confirm: { kind: 'cleanup', items: [item, item] } }, 160, 24).map(plain).at(-5), /^Clean up 2 merged tasks\?/);
  const hidden = renderScreen({ ...state, hiddenView: true, rows: [] }, 160, 24).map(plain);
  assert.match(hidden[2], /^Hidden {2}rows you hid with h/);
  assert.match(hidden.at(-1), /^h unhide · H back/);
});

test('Linear decides the label once the issue is done or canceled; PR state shows while it is open', () => {
  const merged = { taskId: 'plans-id', url: 'https://github.com/a/b/pull/9', state: 'MERGED', cleanup: 'pending', mergedAt: new Date().toISOString(), checkedAt: '1', name: 'plans', repositoryPath: '/r/platform', checkout: '/w/plans' };
  const tasks = [task('plans', 'stopped', { stopConfirmed: true, branch: 'jal/pltfrm-3276-plans-modal' })];
  const view = (state) => {
    const data = { tasks, prs: [merged], records: [], linear: { status: 'ok', open: state.type === 'completed' ? [] : [issue('PLTFRM-3276', state.type, { state })], done: state.type === 'completed' ? [issue('PLTFRM-3276', 'completed', { state })] : [] } };
    return [...buildView(0, data), ...buildView(4, data)].find((row) => row.id === 'PLTFRM-3276').agent.text;
  };
  assert.equal(view({ name: 'Done', type: 'completed' }), '✓ done');
  assert.equal(view({ name: 'In Review', type: 'started' }), 'merged');
  assert.equal(view({ name: 'Canceled', type: 'canceled' }), '– canceled');
});
