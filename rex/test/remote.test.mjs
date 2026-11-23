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
  assert.equal(selfName(config, 'elsewhere'), undefined);
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
  assert.equal(chooseHost({ order, statuses: { b1: loaded, mac: { ...loaded, load: 9 } } }), 'b1');
  assert.throws(() => chooseHost({ order, statuses: { b1: { reachable: false, error: 'x' }, mac: { reachable: false, error: 'y' } } }), /No host is reachable/);
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
  assert.match(args.at(-1), /^for port in 3300 3301; do nc -z 127\.0\.0\.1 \$port \|\| nohup "\$HOME\/\.local\/bin\/rex" -S ssh:\/\/b1 forward new -s session:abc-1 -L \$port:127\.0\.0\.1:\$port /);
  assert.throws(() => forwardCommand(config, { ports: '99999', session: 's', self: 'b1' }), /needs --ports/);
  assert.throws(() => forwardCommand(config, { ports: '3300', session: 'x; rm -rf ~', self: 'b1' }), /needs --session/);
  assert.throws(() => forwardCommand({ order: ['b1'], hosts: { b1: { ssh: 'b1' } } }, { ports: '3300', session: 's', self: 'b1' }), /No other machine/);
});
