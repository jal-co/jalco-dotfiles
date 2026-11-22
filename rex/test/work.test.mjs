import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addWork, batchOf, blockers, changeWork, describeWork, findWork, readWork, recordRelease, updateWork, workStatus, workSummary } from '../src/work.ts';

const fixture = (context) => {
  const dir = mkdtempSync(join(tmpdir(), 'rex-work-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'work.json');
};

const playground = (file) => updateWork((doc) => {
  const card = addWork(doc, { title: 'Alert template card alignment', repo: 'mastra', pr: 'https://github.com/mastra-ai/mastra/pull/101' });
  const sidebar = addWork(doc, { title: 'Sidebar details panel', repo: 'mastra' });
  return addWork(doc, { kind: 'batch', title: 'Update Platform playground', package: '@mastra/playground-ui', downstream: 'platform', members: [card.id, sidebar.id] });
}, file);

test('a fix can be just a sentence and survives a fresh read', (context) => {
  const file = fixture(context);
  assert.deepEqual(readWork(file), { version: 1, next: 1, entries: [] });
  const { result } = updateWork((doc) => addWork(doc, { title: '  Address the  toast overflow upstream later ' }), file);
  assert.equal(result.id, 'w1');
  const saved = readWork(file);
  assert.deepEqual(findWork(saved, 'w1'), { ...result, title: 'Address the  toast overflow upstream later' });
  assert.equal(saved.entries[0].kind, 'fix');
  assert.equal(saved.entries[0].state, 'open');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(file, '..')), ['work.json']);
});

test('invalid input or a failed change writes nothing', (context) => {
  const file = fixture(context);
  updateWork((doc) => addWork(doc, { title: 'first' }), file);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => updateWork((doc) => addWork(doc, { title: '' }), file), /Title must be 1 to 300/);
  assert.throws(() => updateWork((doc) => addWork(doc, { title: 'x', pr: 'not a url' }), file), /not a valid pr link/);
  assert.throws(() => updateWork((doc) => addWork(doc, { title: 'x', dependsOn: ['w9'] }), file), /No work entry w9/);
  assert.throws(() => updateWork((doc) => { addWork(doc, { title: 'half' }); throw new Error('boom'); }, file), /boom/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(!existsSync(`${file}.lock`));
});

test('a corrupt or unknown file is reported and never overwritten', (context) => {
  const file = fixture(context);
  writeFileSync(file, '{ nope');
  assert.throws(() => readWork(file), /unreadable.*left unchanged/);
  assert.throws(() => updateWork((doc) => addWork(doc, { title: 'x' }), file), /unreadable/);
  assert.equal(readFileSync(file, 'utf8'), '{ nope');
  writeFileSync(file, JSON.stringify({ version: 2, next: 1, entries: [] }));
  assert.throws(() => readWork(file), /Unknown work queue format/);
  writeFileSync(file, JSON.stringify({ version: 1, next: 2, entries: [{ id: 'w1', kind: 'fix', title: 'x', state: 'open', links: {}, dependsOn: ['w1'] }] }));
  assert.throws(() => readWork(file), /depends on unknown work w1/);
});

test('a live lock makes writers wait and a dead owner lock is reclaimed', (context) => {
  const file = fixture(context);
  writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.pid, birth: 'not this process' }));
  updateWork((doc) => addWork(doc, { title: 'after a crash' }), file);
  assert.equal(readWork(file).entries.length, 1);
  assert.ok(!existsSync(`${file}.lock`));
});

test('a lock held by a live process blocks instead of racing', (context) => {
  const file = fixture(context);
  updateWork((doc) => addWork(doc, { title: 'one' }), file);
  assert.throws(() => updateWork(() => updateWork((doc) => addWork(doc, { title: 'nested' }), file, 50), file), /work queue is busy/);
  assert.equal(readWork(file).entries.length, 1);
});

test('concurrent writers in separate processes never lose an update', async (context) => {
  const file = fixture(context);
  const source = new URL('../src/work.ts', import.meta.url).href;
  const script = `const { addWork, updateWork } = await import(${JSON.stringify(source)}); for (let i = 0; i < 15; i += 1) updateWork((doc) => addWork(doc, { title: 'from ' + process.pid + ' #' + i }), process.argv[1], 10_000);`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))));
  });
  await Promise.all([run(), run(), run(), run()]);
  const doc = readWork(file);
  assert.equal(doc.entries.length, 60);
  assert.equal(new Set(doc.entries.map((entry) => entry.id)).size, 60);
  assert.equal(doc.next, 61);
  assert.deepEqual(readdirSync(join(file, '..')), ['work.json']);
});

test('batches include fixes, track membership and reject a fix in two batches', (context) => {
  const file = fixture(context);
  const { result: batch } = playground(file);
  assert.equal(batch.id, 'w3');
  assert.deepEqual(batch.members.map((member) => member.id), ['w1', 'w2']);
  assert.deepEqual(batch.steps.map((step) => step.text), ['Bump @mastra/playground-ui in platform', 'Apply the integration changes it needs', 'Verify everything together', 'Open one PR']);
  assert.equal(batchOf(readWork(file), 'w1').id, 'w3');
  assert.throws(() => updateWork((doc) => addWork(doc, { kind: 'batch', title: 'Other bump', members: ['w1'] }), file), /w1 would be in both w3 and w4/);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w3', { members: ['w3'] }), file), /w3 is a batch/);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w1', { members: ['w2'] }), file), /w1 is a fix/);
  updateWork((doc) => changeWork(doc, 'w3', { removeMembers: ['w2'] }), file);
  assert.equal(batchOf(readWork(file), 'w2'), undefined);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w3', { removeMembers: ['w2'] }), file), /w2 is not in w3/);
  updateWork((doc) => changeWork(doc, 'w3', { state: 'dropped' }), file);
  updateWork((doc) => addWork(doc, { kind: 'batch', title: 'Next bump', members: ['w1'] }), file);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w3', { state: 'open' }), file), /w1 would be in both w3 and w4/);
});

test('dependency and membership cycles are rejected', (context) => {
  const file = fixture(context);
  playground(file);
  updateWork((doc) => addWork(doc, { title: 'Follow-up', dependsOn: ['w3'] }), file);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w1', { dependsOn: ['w3'] }), file), /cycle: w1 -> w3 -> w1|cycle: w3 -> w1 -> w3/);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w3', { dependsOn: ['w4'] }), file), /cycle/);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w3', { members: ['w4'] }), file), /cycle/);
  assert.throws(() => updateWork((doc) => changeWork(doc, 'w2', { dependsOn: ['w2'] }), file), /cycle|unknown work w2/);
  updateWork((doc) => changeWork(doc, 'w4', { removeDependsOn: ['w3'] }), file);
  assert.deepEqual(findWork(readWork(file), 'w4').dependsOn, []);
});

test('a batch is ready only when every member landed and is confirmed in the recorded release', (context) => {
  const file = fixture(context);
  playground(file);
  let doc = readWork(file);
  assert.equal(workStatus(doc, findWork(doc, 'w3')), 'blocked');
  assert.deepEqual(blockers(doc, findWork(doc, 'w3')), ['w1 has not landed upstream (open)', 'w2 has not landed upstream (open)', '@mastra/playground-ui release not recorded']);
  assert.throws(() => updateWork((d) => recordRelease(d, 'w3', { version: '1.4.0', evidence: 'npm', included: ['w1'] }), file), /w1 has not landed \(open\)/);
  updateWork((d) => { changeWork(d, 'w1', { state: 'done' }); changeWork(d, 'w2', { state: 'done' }); }, file);
  updateWork((d) => recordRelease(d, 'w3', { version: '1.4.0', evidence: 'https://www.npmjs.com/package/@mastra/playground-ui/v/1.4.0 changelog lists #101', included: ['w1'] }), file);
  doc = readWork(file);
  assert.deepEqual(blockers(doc, findWork(doc, 'w3')), ['w2 not confirmed in 1.4.0']);
  assert.throws(() => updateWork((d) => changeWork(d, 'w3', { state: 'done' }), file), /w3 cannot be done yet: w2 not confirmed in 1\.4\.0; step 1 not done/);
  updateWork((d) => recordRelease(d, 'w3', { version: '1.4.1', evidence: '1.4.1 changelog lists both', included: ['w2'] }), file);
  doc = readWork(file);
  assert.deepEqual(blockers(doc, findWork(doc, 'w3')), ['w1 not confirmed in 1.4.1'], 'a new version does not inherit confirmations');
  updateWork((d) => recordRelease(d, 'w3', { version: '1.4.1', evidence: '1.4.1 changelog lists both', included: ['w1'] }), file);
  doc = readWork(file);
  assert.equal(workStatus(doc, findWork(doc, 'w3')), 'ready');
  assert.throws(() => updateWork((d) => changeWork(d, 'w3', { state: 'done', check: [1, 2, 3] }), file), /step 4 not done: Open one PR/);
  assert.equal(findWork(readWork(file), 'w3').steps[0].done, false, 'a rejected change keeps nothing');
  assert.throws(() => updateWork((d) => changeWork(d, 'w3', { check: [5] }), file), /no step 5; it has 4/);
  updateWork((d) => changeWork(d, 'w3', { check: [1, 2, 3, 4], pr: 'https://github.com/mastra-ai/platform/pull/9', state: 'done' }), file);
  doc = readWork(file);
  assert.equal(workStatus(doc, findWork(doc, 'w3')), 'done');
  assert.throws(() => updateWork((d) => changeWork(d, 'w3', { members: ['w1'] }), file), /w3 is done; reopen it/);
});

test('reopening or dropping a member blocks its batch instead of silently completing it', (context) => {
  const file = fixture(context);
  playground(file);
  updateWork((d) => { changeWork(d, 'w1', { state: 'done' }); changeWork(d, 'w2', { state: 'dropped' }); }, file);
  const doc = readWork(file);
  assert.ok(blockers(doc, findWork(doc, 'w3')).includes('w2 was dropped; remove it from the batch or reopen it'));
});

test('dependencies gate done for fixes too', (context) => {
  const file = fixture(context);
  updateWork((doc) => { addWork(doc, { title: 'Upstream API' }); addWork(doc, { title: 'Use it downstream', dependsOn: ['w1'] }); }, file);
  let doc = readWork(file);
  assert.equal(workStatus(doc, findWork(doc, 'w2')), 'blocked');
  assert.throws(() => updateWork((d) => changeWork(d, 'w2', { state: 'done' }), file), /waits on w1 Upstream API \(open\)/);
  updateWork((d) => changeWork(d, 'w1', { state: 'done' }), file);
  doc = readWork(file);
  assert.equal(workStatus(doc, findWork(doc, 'w2')), 'open');
  updateWork((d) => changeWork(d, 'w1', { state: 'dropped' }), file);
  doc = readWork(file);
  assert.deepEqual(blockers(doc, findWork(doc, 'w2')), ['w1 was dropped; remove the dependency or reopen it']);
});

test('links, notes and summaries stay compact and clear on empty values', (context) => {
  const file = fixture(context);
  playground(file);
  updateWork((d) => changeWork(d, 'w2', { note: 'needs a design pass', issue: 'PLTFRM-12', task: 'sidebar-build' }), file);
  updateWork((d) => changeWork(d, 'w1', { pr: '' }), file);
  const doc = readWork(file);
  assert.deepEqual(findWork(doc, 'w1').links, { repo: 'mastra' });
  assert.match(describeWork(doc, findWork(doc, 'w2')), /^w2 fix \[open\] Sidebar details panel \(repo mastra, issue PLTFRM-12, task sidebar-build\)\n {2}note: needs a design pass$/);
  assert.match(workSummary(doc), /w3 batch \[blocked\] Update Platform playground\n {2}delivers @mastra\/playground-ui to platform\n {2}includes: w1 Alert template card alignment \(open\); w2 Sidebar details panel \(open\)\n {2}steps: 1\.\[ \] Bump/);
  assert.equal(workSummary({ version: 1, next: 1, entries: [] }), 'Nothing open in the work queue.');
  assert.throws(() => updateWork((d) => changeWork(d, 'w1', { package: 'x' }), file), /w1 is a fix; only batches have a package/);
});
