import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteItem, remoteSections } from '../src/linear.mjs';
import { actionsFor, machineCells, meta } from '../src/linear-tui.mjs';

const task = (name, state, extra = {}) => ({ id: `${name}-id`, name, state, branch: `jal/${name}`, updatedAt: Date.now() - 5 * 60_000, ...extra });

test('the other machine gets its own Sessions section with live tasks, or says why it cannot', () => {
  const rows = remoteSections({ mac: { tasks: [task('ui-fix', 'working'), task('old', 'stopped')] } });
  assert.deepEqual(rows.filter((row) => row.kind === 'section').map((row) => [row.title, row.count]), [['On mac', 1]]);
  assert.deepEqual(rows.filter((row) => row.kind === 'item').map((row) => [row.id, row.project, row.agent.tone]), [['mac/ui-fix', 'mac', 'yellow']]);
  assert.equal(remoteSections({ mac: { tasks: [task('old', 'stopped')] } }, true).filter((row) => row.kind === 'item').length, 1);
  assert.match(remoteSections({ mac: { tasks: [] } }).find((row) => row.kind === 'note').text, /Nothing running on mac/);
  const down = remoteSections({ mac: { error: 'ssh: connect to host port 22: Operation timed out' } });
  assert.equal(down[0].title, 'On mac');
  assert.deepEqual([down[1].tone, /mac is unreachable: ssh: connect/.test(down[1].text)], ['yellow', true]);
  assert.match(remoteSections({ mac: {} }).find((row) => row.kind === 'note').text, /Checking mac/);
  assert.deepEqual(remoteSections(undefined), []);
});

test('a task on the other machine offers send and stop through its coordinator, and shows its age', () => {
  const live = remoteItem('b1', task('build', 'idle'));
  assert.deepEqual(actionsFor(live, []).map(([key]) => key), ['s', 'd', 'h']);
  assert.deepEqual(actionsFor(remoteItem('b1', task('gone', 'stopped')), []).map(([key]) => key), ['h']);
  assert.deepEqual(meta(live, Date.now()), ['idle', '5m ago']);
});

test('each machine shows a dot: green idle, yellow busy, red hollow when unreachable', () => {
  const cells = machineCells({
    b1: { reachable: true, load: 0.2, cpus: 16, memAvailable: 20e9, memTotal: 28e9 },
    mac: { reachable: true, load: 40, cpus: 18, memAvailable: 9e9, memTotal: 48e9 },
    nas: { reachable: false, error: 'timeout' },
  });
  const dots = cells.filter(([text]) => text === '●' || text === '○').map(([text, tone]) => `${text}${tone}`);
  assert.deepEqual(dots, ['●green', '●yellow', '○red']);
  assert.deepEqual(machineCells(undefined), []);
});
