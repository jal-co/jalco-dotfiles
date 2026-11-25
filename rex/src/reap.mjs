import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BROWSER = /(^|\/)(chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell)( |$)/;
const DEV = new Set(['node', 'python3', 'python', 'bun', 'deno', 'vite', 'next-server', 'MainThread']);
const OWNERS = new Set(['pi', 'claude', 'codex', 'agent-browser', 'node', 'npm', 'npx', 'pnpm', 'bun', 'playwright', 'MainThread']);
const BROWSER_AGE = 30 * 60;
const BROWSER_DAEMON = /(^|\/)agent-browser-(linux|darwin)-(x64|arm64)( |$)/;

export function parsePs(output) {
  return output.split('\n').map((row) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(row)).filter(Boolean)
    .map(([, pid, ppid, age, comm, args]) => ({ pid: Number(pid), ppid: Number(ppid), age: Number(age), comm, args }));
}

export function owned(processes, process) {
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  for (let parent = byPid.get(process.ppid), hops = 0; parent && parent.pid > 1 && hops < 64; parent = byPid.get(parent.ppid), hops += 1) {
    if (OWNERS.has(parent.comm) || BROWSER_DAEMON.test(parent.args) || BROWSER.test(parent.args)) return true;
  }
  return false;
}

export function orphans(processes, { cwdOf = () => undefined } = {}) {
  const found = [];
  for (const process of processes) {
    if (BROWSER.test(process.args) && !process.args.includes('--type=') && process.age > BROWSER_AGE && !owned(processes, process)) {
      found.push({ ...process, why: `browser with no living agent or test runner above it for ${Math.round(process.age / 60)} min` });
      continue;
    }
    if (DEV.has(process.comm) && cwdOf(process.pid)?.endsWith(' (deleted)')) {
      found.push({ ...process, why: `runs in a deleted directory (${cwdOf(process.pid).replace(/ \(deleted\)$/, '')})` });
    }
  }
  return found;
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
const cwdOf = (pid) => { try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return undefined; } };
const startOf = (pid) => { try { return run('ps', ['-o', 'lstart=', '-p', String(pid)]).trim(); } catch { return undefined; } };

async function stop(process) {
  const started = startOf(process.pid);
  if (!started) return 'already gone';
  try { globalThis.process.kill(process.pid, 'SIGTERM'); } catch { return 'already gone'; }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (startOf(process.pid) !== started) return 'stopped';
  }
  try { globalThis.process.kill(process.pid, 'SIGKILL'); } catch {}
  return 'killed after 10s';
}

export async function reap({ dryRun = false, log = console.log } = {}) {
  const processes = parsePs(run('ps', ['-eo', 'pid=,ppid=,etimes=,comm=,args=']));
  for (const process of orphans(processes, { cwdOf })) {
    log(`${dryRun ? 'would stop' : 'stopping'} ${process.pid} ${process.comm}: ${process.why}`);
    if (!dryRun) log(`  ${process.pid}: ${await stop(process)}`);
  }
  for (const args of [['container', 'prune', '--force', '--filter', 'until=24h'], ['image', 'prune', '--force']]) {
    if (dryRun) { log(`would run docker ${args.join(' ')}`); continue; }
    try {
      const summary = run('docker', args).trim().split('\n').at(-1);
      if (!summary.endsWith(": 0B")) log(`docker ${args[0]} prune: ${summary}`);
    } catch (error) {
      log(`docker ${args[0]} prune skipped: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  reap({ dryRun: process.argv.includes('--dry-run') }).catch((error) => { console.error(`reap: ${error.message}`); process.exitCode = 1; });
}
