import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { callRex } from './provider.ts';
import { latestCoordinatorSession } from './coordinator-session.mjs';
import { cwdHolders, processBirth, processCommand, probeProcess, TaskStore, taskRoot } from './tasks.ts';
import { requestState, submitRequest } from './requests.ts';

const RESUME_API = 24;

export function liveCoordinator(root, cwd, { birth = processBirth, holders = cwdHolders } = {}) {
  const dir = join(root, 'coordinators');
  if (!existsSync(dir)) return undefined;
  const inCwd = new Set(holders(cwd) ?? []);
  const live = readdirSync(dir).filter((name) => /^\d+\.json$/.test(name)).flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      return value.version === 1 && value.birth && birth(value.pid) === value.birth && inCwd.has(value.pid) ? [{ pid: value.pid, birth: value.birth }] : [];
    } catch {
      return [];
    }
  });
  if (live.length > 1) throw new Error(`Several live coordinators run in ${cwd} (processes ${live.map((owner) => owner.pid).join(', ')}). Close the extras; nothing was recovered.`);
  return live[0];
}

const shell = /^-|(^|\/)(zsh|bash|fish|sh)$/;

export function tabProgram(surface) {
  const [session, block] = surface.split('/');
  try {
    const info = JSON.parse(callRex(['block', 'call', '-s', session, '-b', block, 'process']));
    const foreground = info.foreground;
    return foreground && !shell.test(foreground.argv0 ?? '') ? foreground : null;
  } catch {
    return null;
  }
}

export function classify(tasks, cwd, coordinator, { birth = processBirth, probe = probeProcess, tab = tabProgram, holders = cwdHolders, command = processCommand } = {}) {
  return tasks.filter((task) => task.originCwd === cwd && !task.completed && (!task.stopConfirmed || task.stashed)).map((task) => {
    const row = { id: task.logicalId ?? task.id, name: task.name, sessionFile: task.sessionFile, branch: task.branch, worktree: task.worktree };
    if (task.stashed) return { ...row, state: 'stashed' };
    const ownerAlive = birth(task.owner.pid) === task.owner.birth;
    if (ownerAlive && !(coordinator && task.owner.pid === coordinator.pid && task.owner.birth === coordinator.birth)) return { ...row, state: 'other-owner', reason: `owned by live coordinator process ${task.owner.pid}` };
    let result;
    try { result = probe(task.identity); } catch (error) { result = { state: 'unknown', reason: String(error) }; }
    if (result.state !== 'crashed') return { ...row, state: result.state, reason: result.reason };
    const program = tab(task.surface);
    if (program) return { ...row, state: 'busy', reason: `its tab already runs ${program.name ?? program.argv0} (process ${program.pid}), started outside the coordinator` };
    const inCheckout = (task.worktree && existsSync(task.worktree) ? holders(task.worktree) ?? [] : []).filter((pid) => !shell.test(command(pid)?.split(' ')[0] ?? ''));
    if (inCheckout.length) return { ...row, state: 'busy', reason: `processes ${inCheckout.join(', ')} already run in its checkout` };
    return { ...row, state: 'crashed', reason: result.reason };
  });
}

export function recoveryMessage(rows) {
  const gone = rows.filter((row) => row.state === 'crashed');
  if (!gone.length) return undefined;
  const list = gone.map((row) => `- ${row.name} (${row.id}): ${row.reason}. Session ${row.sessionFile}${row.worktree ? `, checkout ${row.worktree} on ${row.branch}` : ''}`).join('\n');
  return [
    'rex-recover ran after a Rex or machine restart. These retained tasks have attested agents that are gone:',
    list,
    'Do not resume any of them yet. For each one, read the end of its session file and tell Justin in one short line whether it had finished, was waiting on his review or approval, or was mid-implementation. Then ask him which to resume, and run subagent_resume with that task\'s session file only for the tasks he names.',
    'A resumed task reopens its saved conversation; it must not replay an interrupted tool call, publish, push or restart finished work without a new instruction. Never launch a replacement task. Stashed tasks stay stashed. Keep every branch, checkout, uncommitted file and log.',
  ].join('\n\n');
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (process.argv.slice(2).some((arg) => arg !== '--dry-run')) {
    console.log('Usage: rex-recover [--dry-run]');
    process.exit(process.argv.includes('--help') ? 0 : 2);
  }
  const cwd = join(homedir(), 'rex-coord');
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  const store = new TaskStore();
  const server = JSON.parse(callRex(['whoami', '--json']));
  console.log(`Rex server ${server.rex_version} (API ${server.api_revision}).${server.api_revision >= RESUME_API ? '' : ' It cannot resume programs after a restart; update Rex to preview.25 or later for that.'}`);

  let coordinator = liveCoordinator(taskRoot(), cwd);
  if (dryRun) {
    const saved = latestCoordinatorSession(cwd, agentDir, store.list().map((task) => task.sessionFile));
    console.log(coordinator ? `The coordinator already runs (process ${coordinator.pid}); pinned would leave it alone.` : `pinned would start the coordinator ${saved ? `in ${saved}` : 'in a new conversation'}.`);
  } else {
    const pinned = spawnSync(process.execPath, [fileURLToPath(new URL('./pinned.mjs', import.meta.url))], { stdio: 'inherit' });
    if (pinned.status !== 0) process.exit(pinned.status ?? 1);
    for (let waited = 0; !coordinator && waited < 90_000; waited += 2000) {
      await sleep(2000);
      coordinator = liveCoordinator(taskRoot(), cwd);
    }
    if (!coordinator) {
      console.log('The coordinator has not published its recovery state within 90 seconds, so no task was checked. Run rex-recover again once it is up.');
      process.exit(1);
    }
  }

  const rows = classify(store.list(), cwd, coordinator);
  const label = { alive: 'running', crashed: 'agent gone, needs your decision', unknown: 'unverifiable, left alone', stashed: 'stashed, left alone', 'other-owner': 'left alone', busy: 'already running by hand, left alone' };
  for (const row of rows) console.log(`  ${row.name}: ${label[row.state]}${row.reason && row.state !== 'crashed' ? ` (${row.reason})` : ''}`);
  if (!rows.length) console.log('No retained tasks to recover.');

  const message = recoveryMessage(rows);
  if (!message) return;
  const marker = join(homedir(), '.rex', 'recover.json');
  const key = JSON.stringify({ coordinator, tasks: rows.filter((row) => row.state === 'crashed').map((row) => row.id).sort() });
  if (existsSync(marker) && readFileSync(marker, 'utf8') === key) {
    console.log('This coordinator was already given this list; nothing was sent again.');
    return;
  }
  if (dryRun || !coordinator) {
    console.log(`Would send the coordinator:\n\n${message}`);
    return;
  }
  const id = submitRequest({ origin: cwd, action: 'message', params: { message } });
  for (let waited = 0; waited < 60_000; waited += 1000) {
    const state = requestState(id);
    if (state.state === 'done') {
      if (!state.ok) { console.log(`The coordinator refused the list: ${state.text}`); process.exit(1); }
      mkdirSync(join(homedir(), '.rex'), { recursive: true, mode: 0o700 });
      writeFileSync(marker, key, { mode: 0o600 });
      console.log('Sent the list to the coordinator. Answer it in the Command session to choose which tasks to resume.');
      return;
    }
    await sleep(1000);
  }
  console.log('The coordinator did not pick up the list within 60 seconds. Run rex-recover again.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
