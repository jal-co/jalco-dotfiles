import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters as plain } from 'node:util';
import { test } from 'node:test';
import { TABS, WORK_TAB, buildView, inbox, withoutHidden } from '../src/linear.mjs';
import { LinearApp, actionsFor, legend, renderScreen } from '../src/linear-tui.mjs';
import { addWork, changeWork, readWork, recordRelease, updateWork } from '../src/work.ts';

const items = (rows) => rows.filter((row) => row.kind === 'item');
const base = { tasks: [], prs: [], records: [], archive: [], linear: { status: 'ok', open: [], done: [] } };

const fixture = (context) => {
  const dir = mkdtempSync(join(tmpdir(), 'rex-work-view-'));
  const old = process.env.REX_WORK_FILE;
  process.env.REX_WORK_FILE = join(dir, 'work.json');
  context.after(() => {
    if (old === undefined) delete process.env.REX_WORK_FILE; else process.env.REX_WORK_FILE = old;
    rmSync(dir, { recursive: true, force: true });
  });
  updateWork((doc) => {
    addWork(doc, { title: 'Alert template card alignment', repo: '/Users/justin/dev/mastra', pr: 'https://github.com/mastra-ai/mastra/pull/101' });
    addWork(doc, { title: 'Sidebar details panel', repo: 'mastra' });
    addWork(doc, { kind: 'batch', title: 'Update Platform playground', package: '@mastra/playground-ui', downstream: 'platform', members: ['w1', 'w2'] });
    addWork(doc, { title: 'Toast overflow should wrap upstream', issue: 'PLTFRM-12' });
  });
  return readWork();
};

const land = () => updateWork((doc) => {
  changeWork(doc, 'w1', { state: 'done' });
  changeWork(doc, 'w2', { state: 'done' });
  recordRelease(doc, 'w3', { version: '1.4.0', evidence: 'changelog lists both', included: ['w1', 'w2'] });
}).doc;

test('Work sits before Archive so the other tab keys keep their numbers', () => {
  assert.deepEqual(TABS, ['Inbox', 'Issues', 'Backlog', 'Sessions', 'Today', 'Work', 'Archive']);
  assert.equal(TABS[WORK_TAB], 'Work');
});

test('the Work tab groups a batch with its included fixes and steps, and counts batches not children', (context) => {
  const work = fixture(context);
  const rows = buildView(WORK_TAB, { ...base, work });
  const sections = rows.filter((row) => row.kind === 'section').map((row) => [row.title, row.count]);
  assert.deepEqual(sections, [['Batches', 1], ['Fixes', 1]]);
  assert.deepEqual(items(rows).map((row) => [row.id, row.title, row.agent.text]), [
    ['w3', 'Update Platform playground', '◌ waiting'],
    ['w1', '↳ Alert template card alignment', '○ open'],
    ['w2', '↳ Sidebar details panel', '○ open'],
    ['step 1', '↳ Bump @mastra/playground-ui in platform', ''],
    ['step 2', '↳ Apply the integration changes it needs', ''],
    ['step 3', '↳ Verify everything together', ''],
    ['step 4', '↳ Open one PR', ''],
    ['w4', 'Toast overflow should wrap upstream', '○ open'],
  ]);
  const ready = buildView(WORK_TAB, { ...base, work: land() });
  assert.equal(ready[0].title, 'Ready to land');
  assert.equal(ready[0].count, 1);
  assert.deepEqual(buildView(WORK_TAB, { ...base, work: { version: 1, next: 1, entries: [] } })[0].text, 'Nothing queued. w queues a fix from one sentence, b starts a batch.');
  assert.deepEqual(buildView(WORK_TAB, { ...base, work: { error: 'Work queue unreadable: bad', entries: [] } }), [{ kind: 'note', text: 'Work queue unreadable: bad', tone: 'red' }]);
});

test('hiding a batch hides its children; done work moves behind x', (context) => {
  fixture(context);
  const work = updateWork((doc) => changeWork(doc, 'w4', { state: 'done' })).doc;
  const rows = withoutHidden(buildView(WORK_TAB, { ...base, work }), new Set(['w:w3']));
  assert.deepEqual(items(rows), []);
  assert.equal(rows.at(-1).text, '1 done or dropped   x shows them');
  assert.deepEqual(items(buildView(WORK_TAB, { ...base, work }, { showStopped: true })).at(-1).id, 'w4');
});

test('a fix reopened after its batch is done stays visible under Fixes', (context) => {
  fixture(context);
  land();
  updateWork((doc) => changeWork(doc, 'w3', { check: [1, 2, 3, 4], state: 'done' }));
  const work = updateWork((doc) => changeWork(doc, 'w1', { state: 'open' })).doc;
  const rows = buildView(WORK_TAB, { ...base, work });
  assert.deepEqual(items(rows).map((row) => row.id), ['w1', 'w4']);
  assert.equal(rows.at(-1).text, '2 done or dropped   x shows them');
  assert.deepEqual(items(buildView(WORK_TAB, { ...base, work }, { showStopped: true })).map((row) => row.id), ['w1', 'w4', 'w2', 'w3']);
});

test('heartbeat flags show on the row, reach the Inbox and K dismisses them', (context) => {
  fixture(context);
  const work = updateWork((doc) => { doc.entries.find((entry) => entry.id === 'w4').flag = { text: 'may already be fixed by #8 toast wraps', pr: 'https://github.com/mastra-ai/mastra/pull/8', at: '2026-11-20T12:00:00.000Z' }; }).doc;
  const rows = buildView(0, { ...base, work });
  assert.equal(rows[0].title, 'Check work');
  const row = items(rows)[0];
  assert.equal(row.id, 'w4');
  assert.deepEqual(actionsFor(row, []).map(([key, label]) => `${key} ${label}`), ['enter start', 'space done', 'm batch', 'K not it', 'd drop', 'o PR', 'h hide']);
  assert.match(renderScreen({ tab: 0, rows, cursor: 1, working: 0, capacity: { used: 0, max: 8 }, counts: [], now: Date.now(), records: [] }, 160, 30).map(plain).join('\n'), /open {3}check: may already be fixed by #8 toast wraps/);
  const app = Object.create(LinearApp.prototype);
  Object.assign(app, { state: { tab: 0, rows, cursor: 1 }, data: { work }, linear: { open: [], done: [] }, hidden: new Set(), draw() {} });
  const notes = [];
  app.status = (tone, text) => notes.push([tone, text]);
  app.workKey(row, 'K');
  assert.deepEqual(notes, [['green', 'Dismissed the flag on w4; that PR will not be flagged again.']]);
  assert.equal(inbox({ ...base, work: readWork() }).count, 0);
});

test('only an open batch with nothing blocking it reaches the Inbox', (context) => {
  const work = fixture(context);
  assert.equal(inbox({ ...base, work }).count, 0);
  const ready = land();
  const box = inbox({ ...base, work: ready });
  assert.equal(box.count, 1);
  assert.deepEqual(items(buildView(0, { ...base, work: ready })).map((row) => row.id), ['w3']);
  assert.equal(buildView(0, { ...base, work: ready })[0].title, 'Ready to land');
  const active = updateWork((doc) => changeWork(doc, 'w3', { state: 'active' })).doc;
  assert.equal(inbox({ ...base, work: active }).count, 0);
  assert.equal(inbox(base).count, 0);
});

test('rows show what blocks a batch and keep step rows to one line', (context) => {
  const work = fixture(context);
  const rows = buildView(WORK_TAB, { ...base, work });
  const state = { tab: WORK_TAB, rows, cursor: 1, working: 0, capacity: { used: 0, max: 8 }, counts: [], now: Date.now(), records: [] };
  const screen = renderScreen(state, 160, 40).map(plain);
  const batch = screen.findIndex((text) => text.includes('Update Platform playground'));
  assert.match(screen[batch], /▌ ● Update Platform playground +platform {2}w3 {2}$/);
  assert.match(screen[batch + 1], /waiting {3}w1 has not landed upstream \(open\) \(\+2 more\) {3}0\/4 steps {3}just now/);
  assert.match(screen[batch + 3], /open {3}PR #101 {3}just now/);
  const step = screen.findIndex((text) => text.includes('Bump @mastra/playground-ui'));
  assert.match(screen[step + 1], /Apply the integration changes/);
  assert.match(screen.at(-2), /enter ask about it {3}space done {3}d drop {3}h hide {3}n new {3}w queue fix {3}b new batch/);
});

test('each work row offers only the keys that apply to it', (context) => {
  const work = fixture(context);
  const rows = items(buildView(WORK_TAB, { ...base, work }));
  const keys = (row) => actionsFor(row, []).map(([key, label]) => `${key} ${label}`);
  assert.deepEqual(keys(rows.find((row) => row.id === 'w1')), ['enter start', 'space done', 'm batch', 'd drop', 'o PR', 'h hide']);
  assert.deepEqual(keys(rows.find((row) => row.id === 'step 1')), ['enter check', 'h hide']);
  assert.deepEqual(keys(rows.find((row) => row.id === 'w4')), ['enter start', 'space done', 'm batch', 'd drop', 'h hide']);
  const dropped = updateWork((doc) => changeWork(doc, 'w4', { state: 'dropped' })).doc;
  const row = items(buildView(WORK_TAB, { ...base, work: dropped }, { showStopped: true })).find((entry) => entry.id === 'w4');
  assert.deepEqual(keys(row), ['u reopen', 'h hide']);
  assert.deepEqual(legend({ tab: 0, rows: [], records: [] }).map(([key]) => key), ['n', 'w', '/', 'c', 'H', 'r', '?', 'q']);
});

test('command center keys queue, check off, move, drop and reopen work without starting anything', (context) => {
  fixture(context);
  const app = Object.create(LinearApp.prototype);
  Object.assign(app, {
    state: { tab: WORK_TAB, rows: [], cursor: -1, selected: {} }, data: { work: readWork() },
    linear: { open: [{ identifier: 'PLTFRM-12', url: 'https://linear.app/x/issue/PLTFRM-12' }], done: [] }, hidden: new Set(), pending: new Map(), draw() {},
  });
  const notes = [];
  const opened = [];
  app.status = (tone, text) => notes.push([tone, text]);
  app.ask = (label, submit, value) => { app.prompt = { label, submit, value }; };
  app.request = (...args) => { throw new Error(`unexpected request ${JSON.stringify(args)}`); };
  app.open = (url) => opened.push(url);
  const row = (id) => items(buildView(WORK_TAB, { ...base, work: app.data.work }, { showStopped: true })).find((entry) => entry.id === id);

  app.listKey('w');
  assert.equal(app.prompt.label, 'queue a fix, one sentence');
  app.prompt.submit('Breadcrumb actions');
  assert.deepEqual(notes.at(-1), ['green', 'Queued w5. Nothing was started; enter on it drafts a start message.']);
  assert.equal(readWork().entries.at(-1).title, 'Breadcrumb actions');

  app.workKey(row('w5'), 'm');
  assert.equal(app.prompt.value, 'w3');
  app.prompt.submit('w3');
  assert.deepEqual(readWork().entries.find((entry) => entry.id === 'w3').members.map((member) => member.id), ['w1', 'w2', 'w5']);
  app.workKey(row('w5'), 'm');
  assert.match(app.prompt.label, /empty takes it out of w3/);
  app.prompt.submit('');
  assert.deepEqual(notes.at(-1), ['green', 'Took w5 out of w3.']);

  app.workKey(row('w3'), ' ');
  assert.equal(notes.at(-1)[0], 'red');
  assert.match(notes.at(-1)[1], /w3 cannot be done yet: w1 has not landed upstream/);
  app.workKey(row('step 2'), ' ');
  assert.equal(readWork().entries.find((entry) => entry.id === 'w3').steps[1].done, true);
  app.workKey(row('step 2'), 'enter');
  assert.equal(readWork().entries.find((entry) => entry.id === 'w3').steps[1].done, false);

  app.workKey(row('w1'), ' ');
  assert.equal(readWork().entries.find((entry) => entry.id === 'w1').state, 'done');
  app.workKey(row('w1'), ' ');
  assert.equal(readWork().entries.find((entry) => entry.id === 'w1').state, 'open');

  app.workKey(row('w4'), 'd');
  assert.deepEqual(notes.at(-1), ['green', 'Dropped w4. u reopens it.']);
  app.workKey(row('w4'), ' ');
  assert.deepEqual(notes.at(-1), ['yellow', 'w4 is dropped. Press u to reopen it first.']);
  app.workKey(row('w4'), 'u');
  assert.equal(readWork().entries.find((entry) => entry.id === 'w4').state, 'open');
  app.workKey(row('w4'), 'o');
  assert.deepEqual(opened, ['https://linear.app/x/issue/PLTFRM-12']);

  app.workKey(row('w4'), 'enter');
  assert.equal(app.prompt.label, 'Message the coordinator');
  assert.equal(app.prompt.value, 'Start w4: Toast overflow should wrap upstream');
  app.workKey(row('w3'), 'enter');
  assert.equal(app.prompt.value, 'What is left before w3 (Update Platform playground) can land?');
  app.state.tab = 0;
  app.listKey('b');
  assert.equal(app.prompt.label, 'Message the coordinator');
  app.state.tab = WORK_TAB;
  app.listKey('b');
  app.prompt.submit('Next playground bump');
  assert.equal(readWork().entries.at(-1).kind, 'batch');
});
