import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, freemem, homedir, hostname, loadavg, platform, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { findCoordinator } from './coordinator-session.mjs';
import { callRex } from './provider.ts';
import { githubRepository, knownRepositories, workspaceRepositories } from './repositories.mjs';
import { requestState, submitRequest } from './requests.ts';
import { TaskStore, cleanText } from './tasks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coordinatorCwd = () => join(homedir(), 'rex-coord');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadHosts = (file = join(root, 'config/hosts.json')) => JSON.parse(readFileSync(file, 'utf8'));

export function selfName(config, name = hostname()) {
  const short = name.toLowerCase().split('.')[0];
  return Object.keys(config.hosts).find((key) => config.hosts[key].hostname === short);
}

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

const terminals = (id) => {
  const view = JSON.parse(callRex(['session', 'inspect', id, '--json']));
  return (view.windows ?? []).flatMap((window) => window.layers.flatMap((layer) => layer.blocks))
    .filter((block) => block.creator_name === 'com.superlogical.terminal')
    .map((block) => JSON.parse(callRex(['block', 'call', '-s', id, '-b', block.block_id, 'process'])));
};

function coordinatorRunning() {
  const found = findCoordinator(JSON.parse(callRex(['ls', '--json'])).sessions, terminals, coordinatorCwd());
  return Boolean(found && !found.stopped);
}

async function ensureCoordinator() {
  if (coordinatorRunning()) return;
  execFileSync(process.execPath, [join(root, 'src/pinned.mjs')], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
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
    await ensureCoordinator();
    const worktree = branch ? { branch, base: base ?? (origin ? 'origin/HEAD' : 'HEAD') } : null;
    return { host: hostname(), cwd, ...(await submitAndWait('launch', { name, task, cwd, worktree }, 15 * 60_000)) };
  },
  send: async ({ id, message }) => submitAndWait('send', { id, message }, 5 * 60_000),
  stop: async ({ id }) => submitAndWait('stop', { id }, 5 * 60_000),
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
  const timeout = command === 'launch' ? 16 * 60_000 : command === 'status' ? 15_000 : 6 * 60_000;
  const child = promisify(execFile)('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host.ssh,
    '~/.local/share/mise/shims/node ~/dotfiles/rex/src/remote.mjs agent', command], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  child.child.stdin.end(JSON.stringify(payload));
  return JSON.parse((await child).stdout);
}

export async function statuses(config) {
  const entries = await Promise.all(config.order.map(async (name) => {
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
  rex-remote stop --host H --id ID`;

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
  } });
  const config = loadHosts();
  if (command === 'status') return statuses(config);
  if (command === 'tasks') {
    const names = positionals[0] ? [positionals[0]] : config.order;
    return Object.fromEntries(await Promise.all(names.map(async (name) => {
      try { return [name, await call(config, name, 'tasks')]; } catch (error) { return [name, { error: cleanText(error.stderr || error.message).slice(0, 200) }]; }
    })));
  }
  if (command === 'pick') return { host: chooseHost({ requested: values.host, order: config.order, statuses: await statuses(config) }) };
  if (command === 'launch') {
    if (!values.name || !values.repo) throw new Error('launch needs --name and --repo');
    const task = values.task ?? (await readStdin());
    if (!task.trim()) throw new Error('launch needs the task text in --task or on stdin');
    const host = chooseHost({ requested: values.host, order: config.order, statuses: await statuses(config) });
    return { host, ...(await call(config, host, 'launch', { name: values.name, repo: values.repo, task, branch: values.branch, base: values.base })) };
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
