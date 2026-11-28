import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busy, chooseHost, loadHosts, matchRepository, parseBattery, parseVmStat, selfName } from '../src/remote.mjs';

const idle = { reachable: true, load: 0.5, cpus: 8, memAvailable: 8e9, memTotal: 16e9 };
const loaded = { reachable: true, load: 7.5, cpus: 8, memAvailable: 8e9, memTotal: 16e9 };
const order = ['b1', 'mac'];

test('selfName maps the machine hostname to its host label', () => {
  const config = loadHosts();
  assert.equal(selfName(config, 'b1'), 'b1');
  assert.equal(selfName(config, 'Justins-MacBook-Pro-2.local'), 'mac');
  assert.equal(selfName(config, 'elsewhere', () => undefined), undefined);
  assert.equal(selfName(config, 'Justins-MBP-2.home.local', () => 'Justins-MacBook-Pro-2'), 'mac');
});

test('pmset and vm_stat output parse into battery and available memory', () => {
  assert.deepEqual(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t12%; discharging;"), { percent: 12, onBattery: true });
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged;"), { percent: 100, onBattery: false });
  assert.equal(parseBattery('No batteries'), undefined);
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages active: 99.\nPages inactive: 20.\nPages speculative: 3.\nPages purgeable: 1.\n';
  assert.equal(parseVmStat(vm), 16384 * 34);
});

test('a host is busy on high load, low memory or a low battery', () => {
  assert.equal(busy(idle), false);
  assert.equal(busy(loaded), true);
  assert.equal(busy({ ...idle, memAvailable: 1e9 }), true);
  assert.equal(busy({ ...idle, battery: { onBattery: true, percent: 12 } }), true);
  assert.equal(busy({ ...idle, battery: { onBattery: false, percent: 12 } }), false);
});

test('chooseHost honors the requested host, then prefers the first idle host in order', () => {
  assert.equal(chooseHost({ requested: 'mac', order, statuses: { b1: idle, mac: idle } }), 'mac');
  assert.throws(() => chooseHost({ requested: 'mac', order, statuses: { b1: idle, mac: { reachable: false, error: 'asleep' } } }), /mac is not reachable: asleep/);
  assert.throws(() => chooseHost({ requested: 'nas', order, statuses: { b1: idle } }), /Unknown host nas/);
  assert.equal(chooseHost({ order, statuses: { b1: idle, mac: idle } }), 'b1');
  assert.equal(chooseHost({ requested: 'auto', order, statuses: { b1: loaded, mac: idle } }), 'mac');
  assert.equal(chooseHost({ order, statuses: { b1: idle, mac: { reachable: false, error: 'asleep' } } }), 'b1');
  assert.throws(() => chooseHost({ order, statuses: { b1: loaded, mac: { ...loaded, load: 9 } } }), /No host has capacity/);
  assert.throws(() => chooseHost({ order, statuses: { b1: { reachable: false, error: 'x' }, mac: { reachable: false, error: 'y' } } }), /No host is reachable/);
});

test('memory pressure blocks new dispatch even when the host is explicitly requested', () => {
  const full = { ...idle, memAvailable: idle.memTotal * 0.03 };
  assert.throws(() => chooseHost({ requested: 'b1', order, statuses: { b1: full, mac: idle } }), /b1.*memory/);
  assert.throws(() => chooseHost({ order, statuses: { b1: full, mac: { reachable: false, error: 'asleep' } } }), /No host has capacity/);
  assert.equal(chooseHost({ order, statuses: { b1: full, mac: idle } }), 'mac');
  assert.equal(chooseHost({ requested: 'b1', order, statuses: { b1: loaded, mac: idle } }), 'b1');
});

test('matchRepository finds a checkout by GitHub remote, then by a unique folder name', () => {
  const candidates = [
    { path: '/home/justin/dev/platform', remote: 'mastra-ai/platform' },
    { path: '/home/justin/dotfiles', remote: 'jal-co/jalco-dotfiles' },
    { path: '/home/justin/dev/coord-smoke', remote: undefined },
  ];
  assert.equal(matchRepository(candidates, 'mastra-ai/platform'), '/home/justin/dev/platform');
  assert.equal(matchRepository(candidates, 'Jal-Co/Jalco-Dotfiles'), '/home/justin/dotfiles');
  assert.equal(matchRepository(candidates, 'coord-smoke'), '/home/justin/dev/coord-smoke');
  assert.throws(() => matchRepository(candidates, 'mastra-ai/mastra'), /No checkout of mastra-ai\/mastra/);
  assert.throws(() => matchRepository([...candidates, { path: '/x/platform', remote: 'other/platform' }], 'platform'), /Several checkouts are named platform/);
});

test('forward opens the ports on the other machine through this one, and refuses bad input', async () => {
  const { forwardCommand } = await import('../src/remote.mjs');
  const config = { order: ['b1', 'mac'], hosts: { b1: { ssh: 'b1', hostname: 'b1' }, mac: { ssh: 'me@mac.ts.net', hostname: 'mac' } } };
  const { target, list, args } = forwardCommand(config, { ports: '3300, 3301', session: 'session:abc-1', self: 'b1' });
  assert.deepEqual([target, list], ['mac', [3300, 3301]]);
  assert.equal(args.at(-2), 'me@mac.ts.net');
  const script = args.at(-1);
  assert.match(script, /^dir="\$HOME\/\.cache\/rex-remote\/forwards\/session:abc-1"; mkdir -p "\$dir"; for port in 3300 3301; do /);
  assert.match(script, /nohup sh -c "while :; do ssh -N .* -L 127\.0\.0\.1:\$port:127\.0\.0\.1:\$port b1; sleep 2; done" >\/dev\/null 2>&1 <\/dev\/null & echo \$! > "\$file"; \}/);
  assert.doesNotMatch(script, /forward new/);
  assert.throws(() => forwardCommand(config, { ports: '99999', session: 's', self: 'b1' }), /needs --ports/);
  assert.throws(() => forwardCommand(config, { ports: '3300', session: 'x; rm -rf ~', self: 'b1' }), /needs --session/);
  assert.throws(() => forwardCommand({ order: ['b1'], hosts: { b1: { ssh: 'b1' } } }, { ports: '3300', session: 's', self: 'b1' }), /No other machine/);
});

test('unforward stops only the ssh forwards its session started on the Mac', async () => {
  const { unforwardCommand } = await import('../src/remote.mjs');
  const config = { order: ['b1', 'mac'], hosts: { b1: { ssh: 'b1' }, mac: { ssh: 'me@mac.ts.net' } } };
  const { target, args } = unforwardCommand(config, { session: 'session:abc-1', self: 'b1' });
  assert.deepEqual([target, args.at(-2)], ['mac', 'me@mac.ts.net']);
  assert.match(args.at(-1), /^dir="\$HOME\/\.cache\/rex-remote\/forwards\/session:abc-1"; for file in "\$dir"\/\*\.pid; do .*pkill -P "\$pid"/);
  assert.throws(() => unforwardCommand(config, { session: 'x; rm -rf ~', self: 'b1' }), /unforward needs --session/);
  assert.throws(() => unforwardCommand(config, { session: undefined, self: 'b1' }), /unforward needs --session/);
});

test('forward can name its first port on the Mac with portless, and unname removes it', async () => {
  const { forwardCommand, unnameCommand } = await import('../src/remote.mjs');
  const config = { order: ['b1', 'mac'], hosts: { b1: { ssh: 'b1' }, mac: { ssh: 'me@mac.ts.net' } } };
  const { args } = forwardCommand(config, { ports: '4100,4103', name: 'studio.pltfrm-3925', session: 's', self: 'b1' });
  assert.match(args.at(-1), /proxy start --unprivileged --https .* alias studio\.pltfrm-3925 4100 --force .*\|\| exit 4$/);
  assert.doesNotMatch(forwardCommand(config, { ports: '4100', session: 's', self: 'b1' }).args.at(-1), /portless/);
  assert.throws(() => forwardCommand(config, { ports: '4100', name: 'x;rm -rf ~', session: 's', self: 'b1' }), /--name takes/);
  assert.match(unnameCommand(config, { name: 'studio.pltfrm-3925', self: 'b1' }).args.at(-1), /alias --remove studio\.pltfrm-3925 /);
  assert.throws(() => unnameCommand(config, { name: '-rf', self: 'b1' }), /unname needs --name/);
});

test('a forward comes back after its ssh drops, is not doubled, and unforward stops it for good', async (t) => {
  const { forwardCommand, unforwardCommand } = await import('../src/remote.mjs');
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(join(tmpdir(), 'forward-'));
  const bin = join(home, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'ssh'), `#!/bin/sh\necho start >> "$HOME/starts"\nexec sleep 0.3\n`);
  writeFileSync(join(bin, 'nc'), `#!/bin/sh\n[ -f "$HOME/starts" ]\n`);
  for (const file of ['ssh', 'nc']) chmodSync(join(bin, file), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const config = { order: ['b1', 'mac'], hosts: { b1: { ssh: 'b1' }, mac: { ssh: 'mac' } } };
  const sh = (script) => execFileSync('sh', ['-c', script], { env, encoding: 'utf8' });
  const pidFile = join(home, '.cache/rex-remote/forwards/s/4100.pid');
  t.after(() => { try { sh(unforwardCommand(config, { session: 's', self: 'b1' }).args.at(-1)); } catch {} });

  sh(forwardCommand(config, { ports: '4100', session: 's', self: 'b1' }).args.at(-1));
  const loop = readFileSync(pidFile, 'utf8').trim();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.ok(readFileSync(join(home, 'starts'), 'utf8').split('\n').filter(Boolean).length >= 2, 'ssh is started again after it exits');
  sh(forwardCommand(config, { ports: '4100', session: 's', self: 'b1' }).args.at(-1));
  assert.equal(readFileSync(pidFile, 'utf8').trim(), loop, 'a running forward is not started twice');

  sh(unforwardCommand(config, { session: 's', self: 'b1' }).args.at(-1));
  assert.equal(existsSync(pidFile), false);
  const after = readFileSync(join(home, 'starts'), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(readFileSync(join(home, 'starts'), 'utf8'), after, 'nothing restarts after unforward');
  assert.throws(() => execFileSync('kill', ['-0', loop]));
});
