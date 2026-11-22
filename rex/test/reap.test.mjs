import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orphans, owned, parsePs } from '../src/reap.mjs';

const ps = parsePs(`
    1     0  9000 systemd /sbin/init
  900     1  9000 systemd /usr/lib/systemd/systemd --user
 1000   900  9000 rex /usr/bin/rex server run
 1100  1000  4000 pi pi --approve
 1200  1100  4000 agent-browser agent-browser daemon
 1300  1200  4000 chrome /home/justin/.agent-browser/browsers/chrome-158/chrome --headless
 1301  1300  4000 chrome /home/justin/.agent-browser/browsers/chrome-158/chrome --type=renderer
 2000   900  4000 chrome /home/justin/.cache/ms-playwright/chromium-1200/chrome-linux/chrome --headless
 2001  2000  4000 chrome /home/justin/.cache/ms-playwright/chromium-1200/chrome-linux/chrome --type=gpu-process
 2100   900   600 chrome /home/justin/.cache/ms-playwright/chromium-1200/chrome-linux/chrome --headless
 3000   900  4000 node node /home/justin/.rex/worktrees/x/node_modules/.bin/vite
 3100  1000  4000 node node /home/justin/dev/platform/node_modules/.bin/next dev
`);

test('ps output parses into pid, parent, age, command and arguments', () => {
  assert.equal(ps.length, 12);
  assert.deepEqual(ps[5], { pid: 1300, ppid: 1200, age: 4000, comm: 'chrome', args: '/home/justin/.agent-browser/browsers/chrome-158/chrome --headless' });
});

test('a browser under a living agent is owned; one reparented to systemd is not', () => {
  assert.equal(owned(ps, ps.find((entry) => entry.pid === 1300)), true);
  assert.equal(owned(ps, ps.find((entry) => entry.pid === 2000)), false);
});

test('only old orphaned browsers and dev servers in deleted directories are reaped', () => {
  const cwd = { 3000: '/home/justin/.rex/worktrees/x (deleted)', 3100: '/home/justin/dev/platform' };
  const found = orphans(ps, { cwdOf: (pid) => cwd[pid] });
  assert.deepEqual(found.map((entry) => entry.pid), [2000, 3000]);
  assert.match(found[0].why, /no living agent or test runner above it for 67 min/);
  assert.match(found[1].why, /deleted directory \(\/home\/justin\/\.rex\/worktrees\/x\)/);
});
