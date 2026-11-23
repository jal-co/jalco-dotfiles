import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, freemem, homedir, hostname, loadavg, platform, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { findCoordinator } from './coordinator-session.mjs';
import { callRex, RexSurfaceProvider, repositoryFor, surfaceTarget } from './provider.ts';
import { githubRepository, knownRepositories, workspaceRepositories } from './repositories.mjs';
import { requestState, submitRequest } from './requests.ts';
import { brainName, linkStatus, loadHosts, remoteSnapshot, selfName, sendCommand } from './hosts.ts';
import { TaskStore, cleanText } from './tasks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coordinatorCwd = () => join(homedir(), 'rex-coord');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { loadHosts, selfName };

export function parseBattery(output) {
  const percent = /(\d+)%/.exec(output ?? '')?.[1];
  if (percent === undefined) return undefined;
  return { percent: Number(percent), onBattery: /'Battery Power'/.test(output) };
}

export function parseVmStat(output) {
  const size = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  const pages = (label) => Number(new RegExp(`Pages ${label}:\\s+(\\d+)`).exec(output)?.[1] ?? 0);
  return size * (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable'));
}

export function pressure(status) {
  const cpu = status.load / status.cpus;
  const memory = 1 - status.memAvailable / status.memTotal;
  const battery = status.battery?.onBattery ? 1 - status.battery.percent / 100 : 0;
  return Math.max(cpu, memory, battery);
}

export function busy(status) {
  return status.load / status.cpus > 0.75 || status.memAvailable / status.memTotal < 0.15
    || Boolean(status.battery?.onBattery && status.battery.percent < 40);
}

export function chooseHost({ requested, order, statuses }) {
  if (requested && requested !== 'auto') {
    const status = statuses[requested];
    if (!status) throw new Error(`Unknown host ${requested}. Known hosts: ${order.join(', ')}`);
    if (!status.reachable) throw new Error(`${requested} is not reachable: ${status.error}`);
    return requested;
  }
  const up = order.filter((name) => statuses[name]?.reachable);
  if (!up.length) throw new Error(`No host is reachable: ${order.map((name) => `${name} (${statuses[name]?.error})`).join(', ')}`);
  return up.find((name) => !busy(statuses[name])) ?? [...up].sort((a, b) => pressure(statuses[a]) - pressure(statuses[b]))[0];
}

export function matchRepository(candidates, wanted) {
  const target = wanted.toLowerCase();
  const byRemote = candidates.filter((entry) => entry.remote === target);
  if (byRemote.length) return byRemote[0].path;
  const byName = candidates.filter((entry) => basename(entry.path).toLowerCase() === target.split('/').pop());
  if (byName.length === 1) return byName[0].path;
  if (byName.length > 1) throw new Error(`Several checkouts are named ${wanted}: ${byName.map((entry) => entry.path).join(', ')}. Pass owner/name or a path.`);
  throw new Error(`No checkout of ${wanted} on ${hostname()}. Clone it there first.`);
}

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
}).trim();

const remoteUrl = (path) => {
  try { return git(path, ['remote', 'get-url', 'origin']); } catch { return undefined; }
};

function resolveRepository(wanted) {
  if (isAbsolute(wanted)) {
    if (!existsSync(join(wanted, '.git'))) throw new Error(`${wanted} is not a Git checkout on ${hostname()}`);
    return wanted;
  }
  const paths = knownRepositories({ workspaces: workspaceRepositories([join(homedir(), 'dev'), homedir()]) });
  return matchRepository(paths.map((path) => ({ path, remote: githubRepository(remoteUrl(path)) })), wanted);
}

const terminals = (id) => JSON.parse(callRex(['block', 'ls', '-s', id, '--json'])).blocks
  .filter((block) => block.creator_name === 'com.superlogical.terminal')
  .map((block) => JSON.parse(callRex(['block', 'call', '-s', id, '-b', block.block_id, 'process'])));

export function isWorker(config = loadHosts(), self = selfName(config)) {
  return Boolean(self) && self !== brainName(config);
}

function workerCommand() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  const model = JSON.parse(readFileSync(join(agentDir, 'rex-agents/config.json'), 'utf8')).models?.default;
  if (!model) throw new Error('No default agent model configured for the worker coordinator');
  return ['/usr/bin/env', 'REX_WORKER=1', join(homedir(), '.pi/agent/bin/pi'), '--approve', '--model', model];
}

function repositorySession(cwd) {
  const repo = repositoryFor(cwd);
  const file = join(homedir(), '.rex', 'repositories', `${createHash('sha256').update(repo).digest('hex')}.json`);
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).session : undefined;
  const live = JSON.parse(callRex(['ls', '--json'])).sessions;
  if (saved && live.some((entry) => entry.session_id === saved)) return saved;
  const { session, block } = surfaceTarget(new RexSurfaceProvider().createSurface({ name: 'coordinator', cwd }));
  callRex(['block', 'close', '-s', session, block]);
  return session;
}

export function startWorker({ cwd, session }) {
  const target = session ?? repositorySession(cwd);
  callRex(['api', 'call', '-s', target, 'session.new_block', JSON.stringify({
    flavor: 'com.superlogical.terminal.shell', label: 'coordinator',
    options: { shell: 'none', command: workerCommand(), cwd: coordinatorCwd() },
  })]);
  return target;
}

function coordinatorRunning() {
  const found = findCoordinator(JSON.parse(callRex(['ls', '--json'])).sessions, terminals, coordinatorCwd());
  return Boolean(found && !found.stopped);
}

async function ensureCoordinator(place = {}) {
  if (coordinatorRunning()) return;
  if (isWorker()) startWorker(place);
  else execFileSync(process.execPath, [join(root, 'src/pinned.mjs')], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (coordinatorRunning()) return sleep(5_000);
    await sleep(1_000);
  }
  throw new Error(`The coordinator on ${hostname()} did not start within 45s; nothing was submitted`);
}

async function submitAndWait(action, params, timeoutMs) {
  const id = submitRequest({ origin: coordinatorCwd(), action, params });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = requestState(id);
    if (state.state === 'done') return state;
    await sleep(1_000);
  }
  return { state: 'timeout', ok: false, text: `No result from the ${hostname()} coordinator after ${Math.round(timeoutMs / 1000)}s; the request may still run there` };
}

async function forTask(id, run) {
  const task = new TaskStore().list().find((row) => row.id === id || row.logicalId === id);
  if (!task) throw new Error(`No task ${cleanText(id)} on ${hostname()}`);
  let session;
  try { session = surfaceTarget(task.surface).session; } catch {}
  const live = JSON.parse(callRex(['ls', '--json'])).sessions.some((entry) => entry.session_id === session);
  await ensureCoordinator(live ? { session } : { cwd: task.worktree ?? task.originCwd });
  return run();
}

function memoryAvailable() {
  if (platform() !== 'darwin') return freemem();
  return parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', timeout: 5_000 }));
}

function battery() {
  if (platform() !== 'darwin') return undefined;
  try { return parseBattery(execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 5_000 })); } catch { return undefined; }
}

function taskRows() {
  return new TaskStore().list().map((row) => ({
    id: row.id, name: row.name, state: row.state ?? (row.stopConfirmed ? 'stopped' : 'running'),
    branch: row.branch, worktree: row.worktree, model: row.model, updatedAt: row.updatedAt,
  }));
}

export const agent = {
  status: () => {
    let coordinator;
    try { coordinator = coordinatorRunning(); } catch (error) { coordinator = `unknown: ${cleanText(error.message)}`; }
    return {
      reachable: true, hostname: hostname(), load: loadavg()[0], cpus: cpus().length,
      memAvailable: memoryAvailable(), memTotal: totalmem(), battery: battery(), coordinator,
      running: taskRows().filter((row) => row.state !== 'stopped').length,
    };
  },
  tasks: () => taskRows(),
  launch: async ({ name, repo, task, branch, base }) => {
    const cwd = resolveRepository(repo);
    const origin = remoteUrl(cwd);
    if (origin) git(cwd, ['fetch', '--quiet', 'origin']);
    await ensureCoordinator({ cwd });
    const worktree = branch ? { branch, base: base ?? (origin ? 'origin/HEAD' : 'HEAD') } : null;
    return { host: hostname(), cwd, ...(await submitAndWait('launch', { name, task, cwd, worktree }, 15 * 60_000)) };
  },
  send: async ({ id, message }) => forTask(id, () => submitAndWait('send', { id, message }, 5 * 60_000)),
  stop: async ({ id }) => forTask(id, () => submitAndWait('stop', { id }, 5 * 60_000)),
  resume: async ({ id }) => forTask(id, () => submitAndWait('resume', { id }, 5 * 60_000)),
  stash: async ({ id }) => forTask(id, () => submitAndWait('stash', { id }, 5 * 60_000)),
};

const readStdin = async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

export async function call(config, name, command, payload = {}, { self = selfName(config) } = {}) {
  if (name === self) return agent[command](payload);
  const host = config.hosts[name];
  if (!host) throw new Error(`Unknown host ${name}`);
  if (name !== brainName(config)) {
    const result = await sendCommand(name, command, payload, { timeoutMs: command === 'launch' ? 16 * 60_000 : 6 * 60_000 });
    if (result?.offline && ['status', 'tasks'].includes(command)) throw new Error(result.text);
    return result;
  }
  const timeout = command === 'launch' ? 16 * 60_000 : command === 'status' ? 15_000 : 6 * 60_000;
  const child = promisify(execFile)('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host.ssh,
    '~/.local/share/mise/shims/node ~/dotfiles/rex/src/remote.mjs agent', command], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  child.child.stdin.end(JSON.stringify(payload));
  return JSON.parse((await child).stdout);
}

export function linkedStatus(name) {
  const link = linkStatus(name);
  if (!link.online) return { reachable: false, error: link.reason };
  const snapshot = remoteSnapshot(name, 'status');
  return snapshot?.error ? { reachable: false, error: snapshot.error } : { ...snapshot, reachable: true };
}

export async function tasksOf(config, name, { self = selfName(config) } = {}) {
  if (name === self || name === brainName(config)) return call(config, name, 'tasks');
  const link = linkStatus(name);
  const snapshot = remoteSnapshot(name, 'tasks');
  if (!snapshot) throw new Error(link.reason);
  return snapshot.tasks ?? [];
}

export function forwardCommand(config, { ports, session, desk, self = selfName(config) }) {
  const list = String(ports ?? '').split(',').map((port) => Number(port.trim()));
  if (!list.length || list.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('forward needs --ports, such as 3300,3301');
  if (!/^[\w:.-]{1,120}$/.test(String(session ?? ''))) throw new Error('forward needs --session, or run it inside a Rex tab');
  const target = desk ?? Object.keys(config.hosts).find((name) => name !== self);
  if (!target || target === self || !config.hosts[target]) throw new Error('No other machine to open the ports on');
  const mine = config.hosts[self]?.ssh;
  if (!mine) throw new Error('This machine has no ssh name in hosts.json');
  const rex = `"$HOME/.local/bin/rex" -S ssh://${mine} forward new -s ${session}`;
  const script = `for port in ${list.join(' ')}; do nc -z 127.0.0.1 $port || nohup ${rex} -L $port:127.0.0.1:$port >/dev/null 2>&1 </dev/null & done; sleep 3; for port in ${list.join(' ')}; do nc -z 127.0.0.1 $port || exit 3; done`;
  return { target, list, args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', config.hosts[target].ssh, script] };
}

export async function forwardToDesk(config, options) {
  const { target, list, args } = forwardCommand(config, options);
  try {
    await promisify(execFile)('ssh', args, { encoding: 'utf8', timeout: 30_000 });
  } catch (error) {
    throw new Error(error.code === 3 ? `The forward started on ${target} but a port is not listening there yet; check rex forward ls -s ${options.session}` : `Could not reach ${target}: ${cleanText(error.stderr || error.message).slice(0, 200)}`);
  }
  return { host: target, urls: list.map((port) => `http://localhost:${port}`), close: `rex forward close --all -s ${options.session}` };
}

export async function statuses(config, { self = selfName(config) } = {}) {
  const entries = await Promise.all(config.order.map(async (name) => {
    if (name !== self && name !== brainName(config)) return [name, linkedStatus(name)];
    try { return [name, await call(config, name, 'status')]; } catch (error) {
      return [name, { reachable: false, error: cleanText(error.stderr || error.message).slice(0, 200) }];
    }
  }));
  return Object.fromEntries(entries);
}

const usage = `Usage:
  rex-remote status                      health, load, memory, battery and coordinator of every host
  rex-remote tasks [host]                tasks on one host, or on every reachable host
  rex-remote pick [--host name|auto]     the host a launch would use
  rex-remote launch --name N --repo R [--host name|auto] [--branch B] [--base REF] [--task T]
                                         launch a task through that host's coordinator (task text from --task or stdin)
  rex-remote send --host H --id ID --message M
  rex-remote stop --host H --id ID
  rex-remote resume --host H --id ID     resume a crashed or stashed task there
  rex-remote stash --host H --id ID      stash a task there
  rex-remote forward --ports 3300,3301 [--session S] [--host mac]
                                         make these ports on this machine open as http://localhost:PORT
                                         on the Mac; close them with rex forward close --all -s S

The primary host (first in hosts.json) reaches the others only through the link
each of them keeps open to it; a host that is offline refuses at once.`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'agent') {
    const name = rest[0];
    if (!Object.hasOwn(agent, name)) throw new Error(`Unknown agent command ${name}`);
    const input = await readStdin();
    return agent[name](input.trim() ? JSON.parse(input) : {});
  }
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    host: { type: 'string' }, name: { type: 'string' }, repo: { type: 'string' }, branch: { type: 'string' },
    base: { type: 'string' }, task: { type: 'string' }, id: { type: 'string' }, message: { type: 'string' },
    ports: { type: 'string' }, session: { type: 'string' },
  } });
  const config = loadHosts();
  if (command === 'status') return statuses(config);
  if (command === 'tasks') {
    const names = positionals[0] ? [positionals[0]] : config.order;
    return Object.fromEntries(await Promise.all(names.map(async (name) => {
      try { return [name, await tasksOf(config, name)]; } catch (error) { return [name, { error: cleanText(error.stderr || error.message).slice(0, 200) }]; }
    })));
  }
  if (command === 'forward') return forwardToDesk(config, { ports: values.ports, session: values.session ?? process.env.REX_SESSION, desk: values.host });
  if (command === 'pick') return { host: chooseHost({ requested: values.host, order: config.order, statuses: await statuses(config) }) };
  if (command === 'launch') {
    if (!values.name || !values.repo) throw new Error('launch needs --name and --repo');
    const task = values.task ?? (await readStdin());
    if (!task.trim()) throw new Error('launch needs the task text in --task or on stdin');
    const host = chooseHost({ requested: values.host, order: config.order, statuses: await statuses(config) });
    return { host, ...(await call(config, host, 'launch', { name: values.name, repo: values.repo, task, branch: values.branch, base: values.base })) };
  }
  if (['resume', 'stash'].includes(command)) {
    if (!values.host || !values.id) throw new Error(`${command} needs --host and --id`);
    return call(config, values.host, command, { id: values.id });
  }
  if (command === 'send' || command === 'stop') {
    if (!values.host || !values.id) throw new Error(`${command} needs --host and --id`);
    if (command === 'send' && !values.message) throw new Error('send needs --message');
    return call(config, values.host, command, { id: values.id, message: values.message });
  }
  console.log(usage);
  process.exitCode = command === undefined || command === '--help' ? 0 : 2;
  return undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((result) => {
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  }, (error) => {
    console.error(`rex-remote: ${cleanText(error.message)}`);
    process.exitCode = 1;
  });
}
