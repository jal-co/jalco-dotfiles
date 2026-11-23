import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { callRex } from './provider.ts';
import { owned } from './reap.mjs';
import { cleanText, TaskStore } from './tasks.ts';

const TICKS_PER_SECOND = 100;
const PAGE = 4096;
const BROWSER_IDLE_SECONDS = 30 * 60;
const AGENTS = new Set(['pi', 'claude', 'codex']);
const DEV = /^(node|python3?|bun|deno|vite|next-server|MainThread|ruby|go|java|uvicorn|gunicorn|esbuild|turbo|pnpm|npm)$/;
const BROWSER = /(^|\/)(chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell)( |$)/;
const home = homedir();
const short = (path) => (path?.startsWith(home) ? `~${path.slice(home.length)}` : path);
const tryRead = (file) => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };

export function parseMeminfo(text) {
  const values = Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+) kB$/gm)].map(([, key, kb]) => [key, Number(kb) * 1024]));
  return { total: values.MemTotal, available: values.MemAvailable, swapTotal: values.SwapTotal, swapUsed: values.SwapTotal - values.SwapFree };
}

export function parsePressure(text = '') {
  const avg60 = (kind) => Number(new RegExp(`^${kind} .*avg60=([\\d.]+)`, 'm').exec(text)?.[1] ?? Number.NaN);
  return { some60: avg60('some'), full60: avg60('full') };
}

export function parseCpuTicks(text) {
  const fields = text.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  return { idle: fields[3] + (fields[4] ?? 0), total: fields.reduce((sum, value) => sum + value, 0) };
}

export function parseStat(text) {
  const close = text.lastIndexOf(')');
  const fields = text.slice(close + 2).split(' ');
  return { comm: text.slice(text.indexOf('(') + 1, close), ppid: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]), start: Number(fields[19]), rss: Number(fields[21]) * PAGE };
}

export function parseCgroup(text = '') {
  const path = text.trim().split('\n').at(-1)?.replace(/^0::/, '') ?? '';
  const terminal = /\/rex\.service\/terminal-([0-9a-f-]{36})$/.exec(path);
  if (terminal) return { kind: 'tab', block: `block:${terminal[1]}` };
  const service = /\/([^/]+)\.service$/.exec(path);
  if (service) return { kind: 'service', unit: service[1] };
  if (/\/session-[^/]+\.scope$/.test(path)) return { kind: 'login' };
  return { kind: 'unknown' };
}

export function parseListeners(output) {
  const ports = new Map();
  for (const line of output.split('\n')) {
    const address = /^\S+\s+\d+\s+\d+\s+\S+:(\d+)\s/.exec(line);
    if (!address) continue;
    for (const [, pid] of line.matchAll(/pid=(\d+)/g)) ports.set(Number(pid), [...new Set([...(ports.get(Number(pid)) ?? []), Number(address[1])])]);
  }
  return ports;
}

function commandName(entry) {
  if (BROWSER.test(entry.args)) return 'headless Chrome';
  if (/^(ba|z|da|fi)?sh$/.test(entry.comm)) return entry.comm;
  const parts = entry.args.split(/\s+/);
  const script = parts.slice(1).find((part) => /^[\w@.~/-]+$/.test(part) && (/\.(c|m)?(js|ts)$|\.py$/.test(part) || part.includes('/')));
  if (AGENTS.has(entry.comm)) return entry.comm;
  const mcp = parts.find((part) => /mcp/i.test(part) && !part.startsWith('-'));
  if (mcp) return mcp.split('/').findLast((segment) => /mcp/i.test(segment)).replace(/\.(c|m)?js$/, '');
  if (script) return basename(script).replace(/\.(m?js|ts|py)$/, '');
  return basename(parts[0] || entry.comm);
}

const placed = (cgroup) => cgroup.kind === 'tab' || cgroup.kind === 'service' || cgroup.kind === 'login';

function cgroupOf(byPid, entry) {
  for (let current = entry, hops = 0; current && current.pid > 1 && hops < 64; current = byPid.get(current.ppid), hops += 1) {
    if (placed(current.cgroup)) return current.cgroup;
  }
  return entry.cgroup;
}


const RULES = [
  ['protected', (entry) => entry.comm === 'rex' && 'the Rex server'],
  ['protected', (entry) => AGENTS.has(entry.comm) && 'an agent; stop it from its task'],
  ['protected', (entry, context) => context.self.has(entry.pid) && 'this view'],
  ['protected', (entry) => entry.args.includes('rex/src/link.mjs') && 'the link to the Mac'],
  ['protected', (entry) => entry.cgroup.kind === 'service' && entry.cgroup.unit !== 'rex' && `part of the ${entry.cgroup.unit} service`],
  ['stale', (entry) => entry.deleted && `its folder was deleted (${short(entry.cwd)})`],
  ['stale', (entry, context) => entry.cgroup.kind === 'tab' && context.tabs && !context.tabs.has(entry.cgroup.block) && 'its Rex tab was closed'],
  ['stale', (entry) => entry.task && (entry.task.stopConfirmed || entry.task.state === 'stopped') && `its task ${entry.task.name} is stopped`],
  ['stale', (entry, context) => entry.browser && entry.age > BROWSER_IDLE_SECONDS && !owned(context.entries, entry) && `no agent or test runner has used it for ${Math.round(entry.age / 60)} min`],
  ['owned', (entry, context) => entry.cgroup.kind === 'tab' && context.tabs?.has(entry.cgroup.block) && `runs in ${context.tabs.get(entry.cgroup.block)}`],
  ['unsure', (entry) => entry.cgroup.kind === 'tab' && 'runs in a Rex tab, but Rex did not answer'],
  ['unsure', (entry) => (entry.cgroup.kind === 'login' ? 'started from an SSH or login shell, so no task owns it' : 'no Rex tab or service owns it')],
];

export function classify(entry, context) {
  for (const [status, rule] of RULES) {
    const reason = rule(entry, context);
    if (reason) return { status, reason };
  }
  return undefined;
}

const worth = (row) => row.ports.length || row.browser || DEV.test(row.comm);

export function describe({ entries, listeners = new Map(), tasks = [], tabs, self = new Set(), selfPid, previous = new Map(), elapsed, now = Date.now(), uptime }) {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const byBlock = new Map(tasks.filter((task) => task.surface?.includes('/')).map((task) => [task.surface.split('/')[1], task]));
  const byCheckout = tasks.filter((task) => task.worktree).sort((a, b) => b.worktree.length - a.worktree.length);
  const context = { byPid, entries, tabs, self };
  return entries.filter((entry) => entry.pid !== selfPid && !(BROWSER.test(entry.args) && entry.args.includes('--type='))).map((entry) => {
    const deleted = entry.cwd?.endsWith(' (deleted)');
    const cwd = entry.cwd?.replace(/ \(deleted\)$/, '');
    const cgroup = cgroupOf(byPid, entry);
    const task = (cgroup.kind === 'tab' && byBlock.get(cgroup.block)) || byCheckout.find((row) => cwd && (cwd === row.worktree || cwd.startsWith(`${row.worktree}/`)));
    const age = Math.max(0, Math.round(uptime - entry.start / TICKS_PER_SECOND));
    const row = { ...entry, cgroup, cwd, deleted, task, age, browser: BROWSER.test(entry.args), ports: listeners.get(entry.pid) ?? [] };
    const before = previous.get(`${entry.pid}:${entry.start}`);
    const verdict = classify(row, context);
    return {
      pid: entry.pid, start: entry.start, name: commandName(entry), comm: entry.comm, rss: entry.rss,
      cpu: before !== undefined && elapsed > 0 ? Math.max(0, ((entry.ticks - before) / TICKS_PER_SECOND / elapsed) * 100) : undefined,
      command: cleanText(entry.args).slice(0, 300), cwd: short(cwd), ports: row.ports, startedAt: now - age * 1000,
      task: task?.name, tab: cgroup.kind === 'tab' ? tabs?.get(cgroup.block) : undefined,
      status: verdict.status, reason: verdict.reason, browser: row.browser,
    };
  });
}

const isRexServer = (row) => row.comm === 'rex' && / server run\b/.test(row.command);
const isTailscale = (row) => row.comm === 'tailscaled';

export function routine(rows) {
  const servers = rows.filter(isRexServer).length;
  const daemons = rows.filter((row) => isTailscale(row) && !/ be-child /.test(row.command)).length;
  return rows.filter((row) => !(isRexServer(row) && servers < 2) && !(isTailscale(row) && (daemons < 2 || / be-child /.test(row.command))));
}

export function attention(rows) {
  const order = { stale: 0, unsure: 1 };
  return rows.filter((row) => row.status === 'stale' || (row.status === 'unsure' && worth(row)))
    .sort((a, b) => order[a.status] - order[b.status] || b.rss - a.rss);
}

export function memoryTone({ total, available, swapUsed, pressure }) {
  if (available < total * 0.1 || pressure.full60 > 5) return 'red';
  if (available < total * 0.25 || swapUsed > 1024 ** 3 || pressure.some60 > 10) return 'yellow';
  return 'green';
}

const BLOCKS = '▁▂▃▄▅▆▇█';

export const sparkline = (values, max) => values.map((value) => BLOCKS[Math.max(0, Math.min(7, Math.floor((value / max) * 8)))]).join('');
export const meter = (fraction, width = 20) => {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
};

export function parseSar(text, pick) {
  return text.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (!/^\d\d:\d\d:\d\d$/.test(fields[0])) return [];
    const value = Number(pick(fields));
    return Number.isFinite(value) ? [value] : [];
  });
}

function readHistory(minutes = 60) {
  try {
    const sar = (flag) => execFileSync('sar', [flag], { encoding: 'utf8', timeout: 5_000, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
    return {
      minutes,
      cpu: parseSar(sar('-u'), (fields) => (fields[1] === 'all' ? 100 - Number(fields.at(-1)) : Number.NaN)).slice(-minutes),
      available: parseSar(sar('-r'), (fields) => Number(fields[2]) * 1024).slice(-minutes),
      swap: parseSar(sar('-S'), (fields) => Number(fields[2]) * 1024).slice(-minutes),
    };
  } catch {
    return undefined;
  }
}


function readEntries(uid) {
  const entries = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (statSync(`/proc/${name}`).uid !== uid) continue;
      const stat = parseStat(readFileSync(`/proc/${name}/stat`, 'utf8'));
      let cwd;
      try { cwd = readlinkSync(`/proc/${name}/cwd`); } catch {}
      const args = readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') || stat.comm;
      entries.push({ pid: Number(name), ...stat, args, cwd, cgroup: parseCgroup(tryRead(`/proc/${name}/cgroup`)) });
    } catch {}
  }
  return entries;
}

function readTabs() {
  try {
    const tabs = new Map();
    for (const session of JSON.parse(callRex(['ls', '--json'])).sessions ?? []) {
      const windows = new Map((JSON.parse(callRex(['session', 'inspect', session.session_id, '--json'])).windows ?? []).flatMap((window) =>
        (window.layers ?? []).flatMap((layer) => layer.blocks ?? []).map((block) => [block.block_id, window.label])));
      for (const block of JSON.parse(callRex(['block', 'ls', '-s', session.session_id, '--json'])).blocks ?? []) {
        const tab = windows.get(block.block_id);
        tabs.set(block.block_id, cleanText(`${session.label} ${tab ? `tab ${tab}` : 'hidden block'}`).slice(0, 80));
      }
    }
    return tabs;
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ancestors = (pid) => {
  const found = new Set();
  for (let current = pid, hops = 0; current > 1 && hops < 64; hops += 1) {
    found.add(current);
    current = parseStat(readFileSync(`/proc/${current}/stat`, 'utf8')).ppid;
  }
  return found;
};

let last;

export function parseJobs(timersJson, showText, home = homedir()) {
  const services = new Map(showText.split('\n\n').map((block) => {
    const fields = Object.fromEntries(block.split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return [fields.Id, fields];
  }));
  return JSON.parse(timersJson).flatMap((timer) => {
    const service = services.get(timer.activates);
    if (!service?.FragmentPath?.startsWith(`${home}/`)) return [];
    const failed = service.Result !== 'success' || service.ActiveState === 'failed';
    return [{ name: timer.unit.replace(/\.timer$/, ''), lastAt: timer.last ? Math.round(timer.last / 1000) : undefined, nextAt: timer.next ? Math.round(timer.next / 1000) : undefined, running: service.ActiveState === 'activating' || service.ActiveState === 'active', failed }];
  });
}

function readJobs() {
  try {
    const timers = execFileSync('systemctl', ['--user', 'list-timers', '--all', '--output=json', '--no-pager'], { encoding: 'utf8', timeout: 5_000 });
    const units = JSON.parse(timers).map((timer) => timer.activates).filter(Boolean);
    if (!units.length) return [];
    const show = execFileSync('systemctl', ['--user', 'show', ...units, '-p', 'Id,Result,ActiveState,FragmentPath'], { encoding: 'utf8', timeout: 5_000 });
    return parseJobs(timers, show);
  } catch {
    return undefined;
  }
}

export async function readMachine({ uid = process.getuid(), self = process.pid } = {}) {
  if (!last || Date.now() - last.at > 60_000) {
    last = { at: Date.now(), cpu: parseCpuTicks(readFileSync('/proc/stat', 'utf8')), ticks: new Map(readEntries(uid).map((entry) => [`${entry.pid}:${entry.start}`, entry.ticks])) };
    await sleep(500);
  }
  const at = Date.now();
  const cpu = parseCpuTicks(readFileSync('/proc/stat', 'utf8'));
  const entries = readEntries(uid);
  const uptime = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  let listeners = new Map();
  try { listeners = parseListeners(execFileSync('ss', ['-ltnpH'], { encoding: 'utf8', timeout: 10_000 })); } catch {}
  const rows = describe({ entries, listeners, tasks: new TaskStore().list(), tabs: readTabs(), self: ancestors(self), selfPid: self, previous: last.ticks, elapsed: (at - last.at) / 1000, now: at, uptime });
  const memory = { ...parseMeminfo(readFileSync('/proc/meminfo', 'utf8')), pressure: parsePressure(tryRead('/proc/pressure/memory')) };
  const busy = cpu.total > last.cpu.total ? 100 * (1 - (cpu.idle - last.cpu.idle) / (cpu.total - last.cpu.total)) : undefined;
  last = { at, cpu, ticks: new Map(entries.map((entry) => [`${entry.pid}:${entry.start}`, entry.ticks])) };
  return {
    at, cpu: { cores: cpus().length, busy, load: loadavg() },
    memory: { ...memory, tone: memoryTone(memory) },
    memoryTop: [...routine(rows)].sort((a, b) => b.rss - a.rss).slice(0, 6),
    cpuTop: routine(rows).filter((row) => row.cpu >= 1).sort((a, b) => b.cpu - a.cpu).slice(0, 4),
    attention: attention(rows),
    history: readHistory(),
    uptime,
    jobs: readJobs(),
  };
}

export async function stopProcess({ pid, start }, { read = readMachine, kill = process.kill.bind(process), startOf = (id) => { try { return parseStat(readFileSync(`/proc/${id}/stat`, 'utf8')).start; } catch { return undefined; } }, wait = sleep } = {}) {
  const snapshot = await read();
  const row = snapshot.attention.find((candidate) => candidate.pid === pid);
  if (!row) throw new Error('That process is gone or no longer needs attention; refresh and look again');
  if (row.start !== start) throw new Error('That process ID now belongs to a different process; refresh and look again');
  kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(500);
    if (startOf(pid) !== start) return { ok: true, text: `Stopped ${row.name} (${pid}).` };
  }
  if (startOf(pid) !== start) return { ok: true, text: `Stopped ${row.name} (${pid}).` };
  kill(pid, 'SIGKILL');
  return { ok: true, text: `${row.name} (${pid}) ignored the request to stop, so it was killed.` };
}

if (process.argv[1] && process.argv[1].endsWith('/machine.mjs') && process.argv.includes('--json')) {
  readMachine({ self: process.pid }).then((snapshot) => process.stdout.write(JSON.stringify(snapshot)), (error) => { console.error(`machine: ${error.message}`); process.exitCode = 1; });
}

export async function readMachineAsync({ execFile = promisify(execFileCallback) } = {}) {
  const { stdout } = await execFile(process.execPath, [fileURLToPath(import.meta.url), '--json'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}
