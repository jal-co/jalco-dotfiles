import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classify, liveCoordinator, recoveryMessage } from '../src/recover.mjs';

const cwd = '/home/u/rex-coord';
const coordinator = { pid: 10, birth: 'B10' };
const task = (name, extra = {}) => ({ id: `${name}-id`, name, originCwd: cwd, sessionFile: `/s/${name}.jsonl`, surface: `session:a/block:${name}`, owner: { pid: 1, birth: 'old' }, identity: { pid: 2, birth: 'gone' }, ...extra });
const births = { 10: 'B10', 11: 'B11' };
const deps = (overrides = {}) => ({
  birth: (pid) => births[pid] ?? null,
  probe: (identity) => identity.pid === 3 ? { state: 'alive', reason: 'match' } : identity.pid === 4 ? { state: 'unknown', reason: 'unreadable' } : { state: 'crashed', reason: `Process ${identity.pid} is absent` },
  tab: () => null,
  holders: () => [],
  command: () => '-zsh',
  ...overrides,
});

test('only attested-gone tasks with a free tab and checkout are offered for a decision', () => {
  const rows = classify([
    task('gone'),
    task('running', { identity: { pid: 3, birth: 'x' } }),
    task('unverifiable', { identity: { pid: 4, birth: 'x' } }),
    task('stashed', { stopConfirmed: true, stashed: { at: 1 } }),
    task('finished', { completed: {} }),
    task('stopped', { stopConfirmed: true }),
    task('elsewhere', { originCwd: '/other' }),
    task('theirs', { owner: { pid: 11, birth: 'B11' } }),
    task('mine', { owner: { pid: 10, birth: 'B10' } }),
  ], cwd, coordinator, deps());
  assert.deepEqual(rows.map((row) => [row.name, row.state]), [
    ['gone', 'crashed'], ['running', 'alive'], ['unverifiable', 'unknown'], ['stashed', 'stashed'], ['theirs', 'other-owner'], ['mine', 'crashed'],
  ]);
});

test('a task whose tab or checkout already runs a program is left alone, but restored shells do not count', () => {
  const tab = (surface) => surface.endsWith('/block:inTab') ? { pid: 7, name: 'node' } : null;
  const dir = mkdtempSync(join(tmpdir(), 'rex-recover-'));
  const holders = () => [8, 9];
  const command = (pid) => pid === 8 ? '-zsh' : pid === 9 ? 'pi' : null;
  const rows = classify([task('inTab'), task('inCheckout', { worktree: dir }), task('shellOnly', { worktree: dir })], cwd, coordinator, deps({ tab, holders: (path) => path === dir ? holders() : [], command: (pid) => command(pid) }));
  assert.equal(rows[0].state, 'busy');
  assert.match(rows[0].reason, /tab already runs node \(process 7\)/);
  assert.equal(rows[1].state, 'busy');
  assert.match(rows[1].reason, /processes 9 already run in its checkout/);
  const shells = classify([task('shellOnly', { worktree: dir })], cwd, coordinator, deps({ holders: () => [8] }));
  assert.equal(shells[0].state, 'crashed');
});

test('the coordinator is asked to check each conversation and to resume only what Justin names', () => {
  assert.equal(recoveryMessage([{ name: 'a', state: 'alive' }, { name: 'b', state: 'stashed' }]), undefined);
  const text = recoveryMessage([{ name: 'gone', id: 'gone-id', state: 'crashed', reason: 'Process 2 is absent', sessionFile: '/s/gone.jsonl', worktree: '/w', branch: 'b' }, { name: 'kept', state: 'stashed' }]);
  assert.match(text, /- gone \(gone-id\): Process 2 is absent\. Session \/s\/gone\.jsonl, checkout \/w on b/);
  assert.doesNotMatch(text, /kept/);
  assert.match(text, /Do not resume any of them yet/);
  assert.match(text, /only for the tasks he names/);
  assert.match(text, /must not replay an interrupted tool call, publish, push/);
  assert.match(text, /Never launch a replacement task\. Stashed tasks stay stashed/);
});

test('a coordinator counts only when its published start time matches and it runs in the coordinator directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'rex-recover-'));
  mkdirSync(join(root, 'coordinators'));
  const publish = (pid, birth) => writeFileSync(join(root, 'coordinators', `${pid}.json`), JSON.stringify({ version: 1, takeover: 1, pid, birth, hosted: [] }));
  publish(10, 'B10');
  publish(11, 'stale');
  publish(12, 'B12');
  writeFileSync(join(root, 'coordinators', '13.json'), 'not json');
  const birth = (pid) => ({ 10: 'B10', 11: 'B11', 12: 'B12' })[pid] ?? null;
  assert.deepEqual(liveCoordinator(root, cwd, { birth, holders: () => [10, 11] }), { pid: 10, birth: 'B10' });
  assert.equal(liveCoordinator(root, cwd, { birth, holders: () => [] }), undefined);
  assert.throws(() => liveCoordinator(root, cwd, { birth, holders: () => [10, 12] }), /Several live coordinators/);
  assert.equal(liveCoordinator(join(root, 'missing'), cwd, { birth }), undefined);
});
