import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attention, describe, memoryTone, meter, parseCgroup, parseJobs, routine, parseMeminfo, parsePressure, parseSar, parseStat, sparkline, stopProcess } from '../src/machine.mjs';

const TAB = 'block:01a208ad-41b1-73bf-b674-13f14bcd271b';
const GONE = 'block:01a20000-0000-7000-8000-000000000000';
const proc = (pid, fields = {}) => ({ pid, ppid: 1, comm: 'node', args: 'node server.js', start: 1000, ticks: 0, rss: 100 * 2 ** 20, cwd: '/home/justin/dev/app', cgroup: { kind: 'tab', block: TAB }, ...fields });
const view = (entries, extra = {}) => describe({ entries, tabs: new Map([[TAB, 'platform tab PLTFRM-3925']]), uptime: 100_000, now: 1_000_000_000, ...extra });
const byPid = (rows, pid) => rows.find((row) => row.pid === pid);

test('cgroups name the Rex tab, the service or the login that started a process', () => {
  assert.deepEqual(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/rex.service/terminal-01a208ad-41b1-73bf-b674-13f14bcd271b\n'), { kind: 'tab', block: TAB });
  assert.deepEqual(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/rex-alerts.service'), { kind: 'service', unit: 'rex-alerts' });
  assert.deepEqual(parseCgroup('0::/system.slice/docker.service'), { kind: 'service', unit: 'docker' });
  assert.deepEqual(parseCgroup('0::/user.slice/user-1000.slice/session-c49.scope'), { kind: 'login' });
  assert.deepEqual(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-org.chromium.Chromium-1.scope'), { kind: 'unknown' });
});

test('process stat parsing survives spaces and parentheses in the command name', () => {
  const fields = ['S', '42', ...Array(9).fill('0'), '30', '12', ...Array(6).fill('0'), '777', '0', '25'];
  assert.deepEqual(parseStat(`99 (Web (Content) x) ${fields.join(' ')}`), { comm: 'Web (Content) x', ppid: 42, ticks: 42, start: 777, rss: 25 * 4096 });
});

test('a process is stale only on verified evidence, and uncertain ownership stays separate from stale', () => {
  const rows = view([
    proc(10, { cwd: '/home/justin/dev/old (deleted)' }),
    proc(11, { cgroup: { kind: 'tab', block: GONE } }),
    proc(12, { cgroup: { kind: 'tab', block: GONE }, cwd: '/home/justin/.rex/worktrees/repo/feat' }),
    proc(13, { comm: 'chrome', args: '/opt/chrome --headless', start: 100, cgroup: { kind: 'unknown' } }),
    proc(14),
    proc(15, { cgroup: { kind: 'login' } }),
    proc(16, { comm: 'chrome', args: '/opt/chrome --headless', start: 9_999_000, cgroup: { kind: 'unknown' } }),
  ], { tasks: [{ name: 'feat', worktree: '/home/justin/.rex/worktrees/repo/feat', stopConfirmed: true }] });
  assert.match(byPid(rows, 10).reason, /folder was deleted \(~\/dev\/old\)/);
  assert.equal(byPid(rows, 11).reason, 'its Rex tab was closed');
  assert.equal(byPid(rows, 12).status, 'stale');
  assert.match(byPid(rows, 13).reason, /no agent or test runner has used it for \d+ min/);
  assert.deepEqual([byPid(rows, 14).status, byPid(rows, 14).reason], ['owned', 'runs in platform tab PLTFRM-3925']);
  assert.deepEqual([byPid(rows, 15).status, byPid(rows, 15).reason], ['unsure', 'started from an SSH or login shell, so no task owns it']);
  assert.equal(byPid(rows, 16).status, 'unsure');
  assert.equal(view([proc(17, { comm: 'bash', args: '/bin/bash -c cd ~/.rex/worktrees/x/rex && node -e 1' })])[0].name, 'bash');
  assert.equal(view([proc(18, { args: 'node /home/justin/dev/app/server.mjs --port 3000' })])[0].name, 'server');
  assert.equal(view([proc(19, { comm: 'claude', args: 'claude --strict-mcp-config --mcp-config /tmp/x.json' })])[0].name, 'claude');
  assert.equal(view([proc(21, { args: 'node /home/justin/.npm/_npx/1/node_modules/linear-mcp/dist/index.js' })])[0].name, 'linear-mcp');
  assert.deepEqual(attention(rows).map((row) => [row.pid, row.status]), [[10, 'stale'], [11, 'stale'], [12, 'stale'], [13, 'stale'], [15, 'unsure'], [16, 'unsure']]);
});

test('when Rex does not answer, a tab process is uncertain rather than stale', () => {
  const [row] = view([proc(20, { cgroup: { kind: 'tab', block: GONE } })], { tabs: undefined });
  assert.deepEqual([row.status, row.reason], ['unsure', 'runs in a Rex tab, but Rex did not answer']);
});

test('services, the Rex server, agents, the Mac link and this view are never offered for stopping', () => {
  const rows = view([
    proc(30, { cgroup: { kind: 'service', unit: 'docker' }, cwd: '/ (deleted)' }),
    proc(31, { comm: 'rex', args: '/usr/bin/rex serve', cgroup: { kind: 'service', unit: 'rex' } }),
    proc(32, { comm: 'pi', args: 'pi --approve', cgroup: { kind: 'tab', block: GONE } }),
    proc(33, { args: 'node /home/justin/dotfiles/rex/src/link.mjs serve --host mac', cgroup: { kind: 'login' } }),
    proc(34, { cgroup: { kind: 'tab', block: GONE } }),
  ], { self: new Set([34]) });
  assert.deepEqual(rows.map((row) => row.status), ['protected', 'protected', 'protected', 'protected', 'protected']);
  assert.equal(byPid(rows, 30).reason, 'part of the docker service');
  assert.deepEqual(attention(rows), []);
});

test('a child that moved into its own scope belongs to its parent tab', () => {
  const rows = view([proc(40, { comm: 'agent-browser' }), proc(41, { ppid: 40, comm: 'chrome', args: '/opt/chrome --headless', cgroup: { kind: 'unknown' } })]);
  assert.equal(byPid(rows, 41).status, 'owned');
  assert.equal(byPid(rows, 41).tab, 'platform tab PLTFRM-3925');
});

test('CPU percent comes from the change in ticks for the same process identity only', () => {
  const rows = view([proc(50, { ticks: 250 }), proc(51, { ticks: 900, start: 2000 })], { previous: new Map([['50:1000', 50], ['51:1999', 0]]), elapsed: 2 });
  assert.equal(byPid(rows, 50).cpu, 100);
  assert.equal(byPid(rows, 51).cpu, undefined);
});

test('meminfo is read in bytes', () => {
  assert.deepEqual(parseMeminfo('MemTotal:       30045596 kB\nMemAvailable:   19104496 kB\nSwapTotal:       8388604 kB\nSwapFree:        8388192 kB\n'), { total: 30766690304, available: 19563003904, swapTotal: 8589930496, swapUsed: 421888 });
});

test('memory reads green across this machine\'s history and turns only on sustained pressure', () => {
  const total = 30_766_690_304;
  const calm = { some60: 0, full60: 0 };
  assert.equal(memoryTone({ total, available: 16_189_320 * 1024, swapUsed: 412 * 1024, pressure: calm }), 'green');
  assert.equal(memoryTone({ total, available: total * 0.2, swapUsed: 0, pressure: calm }), 'yellow');
  assert.equal(memoryTone({ total, available: total * 0.5, swapUsed: 2 * 1024 ** 3, pressure: calm }), 'yellow');
  assert.equal(memoryTone({ total, available: total * 0.05, swapUsed: 0, pressure: calm }), 'red');
  assert.equal(memoryTone({ total, available: total * 0.5, swapUsed: 0, pressure: { some60: 3, full60: 8 } }), 'red');
  assert.deepEqual(parsePressure('some avg10=1.00 avg60=12.50 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.40 avg300=0.00 total=1\n'), { some60: 12.5, full60: 0.4 });
});

test('stop verifies the process identity and attention before signalling, and kills only the same process', async () => {
  const stale = { pid: 60, start: 500, name: 'vite', status: 'stale' };
  const read = async () => ({ attention: [stale] });
  const signals = [];
  const kill = (pid, signal) => signals.push([pid, signal]);
  await assert.rejects(stopProcess({ pid: 60, start: 499 }, { read, kill }), /different process/);
  await assert.rejects(stopProcess({ pid: 61, start: 500 }, { read, kill }), /gone or no longer needs attention/);
  assert.deepEqual(signals, []);
  let alive = true;
  const result = await stopProcess({ pid: 60, start: 500 }, { read, kill: (...args) => { kill(...args); alive = false; }, startOf: () => (alive ? 500 : undefined), wait: async () => {} });
  assert.deepEqual([result.text, signals], ['Stopped vite (60).', [[60, 'SIGTERM']]]);
  signals.length = 0;
  const stubborn = await stopProcess({ pid: 60, start: 500 }, { read, kill, startOf: () => 500, wait: async () => {} });
  assert.match(stubborn.text, /killed/);
  assert.deepEqual(signals, [[60, 'SIGTERM'], [60, 'SIGKILL']]);
  signals.length = 0;
  await stopProcess({ pid: 60, start: 500 }, { read, kill, startOf: () => 501, wait: async () => {} });
  assert.deepEqual(signals, [[60, 'SIGTERM']]);
});

test('history comes from sysstat minute rows only, and graphs keep an honest scale', () => {
  const cpu = `Linux 7.0.0-44-generic (b1) \t11/23/26 \t_x86_64_\t(16 CPU)

00:00:01        CPU     %user     %nice   %system   %iowait    %steal     %idle
00:01:01        all      0.37      0.00      0.27      0.07      0.00     99.28
00:02:01        all     50.00      0.00      0.00      0.00      0.00     50.00
03:00:00     LINUX RESTART      (16 CPU)
00:03:01        all      0.00      0.00      0.00      0.00      0.00      0.00
Average:        all      1.16      0.00      0.61      0.09      0.00     98.14
`;
  const busy = parseSar(cpu, (fields) => (fields[1] === 'all' ? 100 - Number(fields.at(-1)) : Number.NaN));
  assert.deepEqual(busy.map((value) => Math.round(value)), [1, 50, 100]);
  const memory = '00:00:01    kbmemfree   kbavail kbmemused\n00:01:01     17317216  27301692   1991440\n';
  assert.deepEqual(parseSar(memory, (fields) => Number(fields[2]) * 1024), [27301692 * 1024]);
  assert.equal(sparkline([0, 12.5, 50, 99, 100, 150], 100), '▁▂▅███');
  assert.deepEqual([meter(0, 4), meter(0.5, 4), meter(1, 4), meter(2, 4)], ['░░░░', '██░░', '████', '████']);
});

test('jobs are the user timers from the home folder, with their last result', () => {
  const timers = JSON.stringify([
    { unit: 'review-sync.timer', activates: 'review-sync.service', last: 1795461144820066, next: 1795461264821544 },
    { unit: 'reap.timer', activates: 'reap.service', last: 1795461038819862, next: 1795462838820772 },
    { unit: 'launchpadlib-cache-clean.timer', activates: 'launchpadlib-cache-clean.service', last: 1, next: 2 },
  ]);
  const show = [
    'Id=review-sync.service\nResult=success\nActiveState=inactive\nFragmentPath=/home/me/.config/systemd/user/review-sync.service',
    'Id=reap.service\nResult=exit-code\nActiveState=failed\nFragmentPath=/home/me/.config/systemd/user/reap.service',
    'Id=launchpadlib-cache-clean.service\nResult=success\nActiveState=inactive\nFragmentPath=/usr/lib/systemd/user/launchpadlib-cache-clean.service',
  ].join('\n\n');
  assert.deepEqual(parseJobs(timers, show, '/home/me'), [
    { name: 'review-sync', lastAt: 1795461144820, nextAt: 1795461264822, running: false, failed: false },
    { name: 'reap', lastAt: 1795461038820, nextAt: 1795462838821, running: false, failed: true },
  ]);
});

test('the Rex server and tailscaled stay off the top lists unless there are two of them', () => {
  const server = (pid) => ({ pid, comm: 'rex', command: '/usr/bin/rex server run --tailscale' });
  const client = { pid: 3, comm: 'rex', command: '/usr/bin/rex events --all --json' };
  const helper = { pid: 4, comm: 'tailscaled', command: '/usr/sbin/tailscaled be-child ssh-fwd --op=dial' };
  const vite = { pid: 5, comm: 'node', command: 'vite' };
  assert.deepEqual(routine([server(1), client, helper, vite]).map((row) => row.pid), [3, 5]);
  assert.deepEqual(routine([server(1), server(2), vite]).map((row) => row.pid), [1, 2, 5]);
});
