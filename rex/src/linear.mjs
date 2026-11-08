import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { cleanText } from './tasks.ts';

const run = promisify(execFile);
const reference = /^op:\/\/[^/\r\n]+\/[^/\r\n]+\/([^/\r\n]+\/)?[^/\r\n]+$/;

export const TABS = ['Issues', 'Backlog', 'Sessions', 'Today'];
export const STATES = {
  blocked: { icon: '!', tone: 'warning' },
  error: { icon: '✕', tone: 'error' },
  unknown: { icon: '?', tone: 'warning' },
  working: { icon: '●', tone: 'accent' },
  stopping: { icon: '◌', tone: 'muted' },
  done: { icon: '✓', tone: 'success' },
  idle: { icon: '○', tone: 'muted' },
  stopped: { icon: '–', tone: 'dim' },
};
const order = Object.keys(STATES);
const rank = (state) => (order.includes(state) ? order.indexOf(state) : order.indexOf('unknown'));
const priority = (issue) => (issue.priority ? issue.priority : 5);

export const linearConfigFile = () => process.env.REX_LINEAR_CONFIG ?? join(homedir(), '.rex', 'linear.json');

export function readLinearConfig(file = linearConfigFile()) {
  if (!existsSync(file)) return { repositories: {} };
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.tokenRef !== undefined && !reference.test(config.tokenRef)) throw new Error(`${file}: tokenRef must be an op:// reference.`);
  for (const path of Object.values(config.repositories ?? {})) {
    if (!isAbsolute(String(path))) throw new Error(`${file}: repositories must map team keys to absolute paths.`);
  }
  return { ...config, repositories: config.repositories ?? {} };
}

export function saveRepository(team, path, file = linearConfigFile()) {
  const config = readLinearConfig(file);
  config.repositories[team] = path;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export async function readToken(tokenRef, read = run) {
  try {
    const { stdout } = await read('op', ['read', '--no-newline', tokenRef], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384,
      env: { ...process.env, AI_AGENT: 'pi', PI_CODING_AGENT: 'true', OP_BIOMETRIC_UNLOCK_ENABLED: 'false' },
    });
    const token = stdout.trim();
    if (!token || /\s/.test(token)) throw new Error('empty or malformed value');
    return token;
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'op was not found on PATH' : error.killed ? 'op read timed out' : 'op read failed';
    throw new Error(`${reason} for ${tokenRef}`, { cause: error });
  }
}

const fields = 'identifier title url branchName priority description completedAt state { name type } team { key } project { name }';

export function issueQuery(since) {
  return `query RexLinear {
  viewer {
    open: assignedIssues(first: 100, orderBy: updatedAt, filter: { state: { type: { in: ["triage", "backlog", "unstarted", "started"] } } }) { nodes { ${fields} } }
    done: assignedIssues(first: 50, orderBy: updatedAt, filter: { completedAt: { gte: ${JSON.stringify(since.toISOString())} } }) { nodes { ${fields} } }
  }
}`;
}

export async function fetchIssues(token, { fetch = globalThis.fetch, now = new Date() } = {}) {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.startsWith('lin_api_') ? token : `Bearer ${token}` },
    body: JSON.stringify({ query: issueQuery(since) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    throw new Error(`Linear API ${response.status}: ${cleanText(body.errors?.[0]?.message ?? response.statusText)}`);
  }
  return { open: body.data.viewer.open.nodes, done: body.data.viewer.done.nodes };
}

export async function loadLinear({ config = readLinearConfig(), token, read, fetch } = {}) {
  if (!config.tokenRef && !token) {
    return { status: 'missing', message: `No Linear token configured.\nAdd {"tokenRef":"op://VAULT/ITEM/credential"} to ${linearConfigFile()}\npointing at a Linear API key in the Agents vault, then press r.`, open: [], done: [] };
  }
  try {
    const value = token ?? await readToken(config.tokenRef, read);
    return { status: 'ok', token: value, ...await fetchIssues(value, { fetch }) };
  } catch (error) {
    return { status: 'error', message: `Linear unavailable: ${cleanText(error.message)}`, open: [], done: [] };
  }
}

export function projectOf(task, records) {
  const record = records.find((row) => row.path === task.worktree);
  if (record?.repo) return basename(record.repo);
  if (task.worktree) return basename(dirname(task.worktree)).replace(/-[0-9a-f]{12}$/, '');
  return 'No checkout';
}

export function pullRequestFor(task, prs) {
  return prs.filter((row) => row.taskId === task.id || (task.worktree && row.checkout === task.worktree))
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))[0];
}

export function linkedTask(issue, tasks) {
  const id = issue.identifier.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[/_-])${id}([/_-]|$)`);
  const matches = tasks.filter((task) => task.branch && (task.branch === issue.branchName || pattern.test(task.branch.toLowerCase())));
  return matches.find((task) => !task.stopConfirmed) ?? matches[0];
}

const live = (task) => Boolean(task) && !task.stopConfirmed && task.state !== 'stopped';

function taskRow(task, prs) {
  const state = task.state ?? 'unknown';
  const pr = pullRequestFor(task, prs);
  const { icon, tone } = STATES[state] ?? STATES.unknown;
  return {
    kind: 'task', item: task, tone,
    text: `  ${icon} ${state.padEnd(8)} ${cleanText(task.name).padEnd(24)} ${(pr ? `PR ${pr.state.toLowerCase()}` : '').padEnd(10)} ${cleanText(task.branch ?? 'no branch')}`,
  };
}

function issueRow(issue, tasks) {
  const task = linkedTask(issue, tasks);
  const marker = task && live(task) ? (STATES[task.state] ?? STATES.unknown).icon : ' ';
  const flag = issue.priority === 1 ? '!!' : issue.priority === 2 ? '! ' : '  ';
  return {
    kind: 'issue', item: issue, tone: task && live(task) ? (STATES[task.state] ?? STATES.unknown).tone : 'text',
    text: `  ${marker} ${flag} ${issue.identifier.padEnd(12)} ${cleanText(issue.state.name).padEnd(12)} ${cleanText(issue.title)}`,
  };
}

const header = (text) => ({ kind: 'header', text, tone: 'title' });
const note = (text, tone = 'muted') => ({ kind: 'note', text: `  ${text}`, tone });

function grouped(items, key, row) {
  const groups = new Map();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, entries]) => [header(name), ...entries.map(row), note('')]);
}

const byPriority = (a, b) => priority(a) - priority(b) || a.identifier.localeCompare(b.identifier);

export function buildRows(tab, data, { showStopped = false, now = Date.now() } = {}) {
  const { tasks, prs, records, linear } = data;
  const empty = linear.status === 'ok' ? undefined : linear.message.split('\n').map((line) => note(line, linear.status === 'error' ? 'error' : 'warning'));
  if (tab === 0 || tab === 1) {
    if (empty) return empty;
    const types = tab === 0 ? ['started', 'unstarted'] : ['backlog', 'triage'];
    const issues = linear.open.filter((issue) => types.includes(issue.state.type)).sort(byPriority);
    if (!issues.length) return [note(tab === 0 ? 'No started or todo issues are assigned to you.' : 'Your backlog is empty.')];
    return tab === 0
      ? types.flatMap((type) => {
          const rows = issues.filter((issue) => issue.state.type === type);
          return rows.length ? [header(type === 'started' ? 'In progress' : 'Todo'), ...rows.map((issue) => issueRow(issue, tasks)), note('')] : [];
        })
      : grouped(issues, (issue) => cleanText(issue.project?.name ?? 'No project'), (issue) => issueRow(issue, tasks));
  }
  if (tab === 2) {
    const shown = tasks.filter((task) => showStopped || live(task));
    const hidden = tasks.length - shown.length;
    const rows = grouped(shown.sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name)),
      (task) => projectOf(task, records), (task) => taskRow(task, prs));
    if (!tasks.length) return [note('No tracked Rex tasks yet.')];
    return [...rows, ...(hidden ? [note(`${hidden} stopped task${hidden === 1 ? '' : 's'} hidden. Press x to show them.`, 'dim')] : [])];
  }
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const active = tasks.filter((task) => live(task) && !['done', 'idle'].includes(task.state));
  const linked = (issue) => live(linkedTask(issue, tasks));
  const started = linear.open.filter((issue) => issue.state.type === 'started' && !linked(issue)).sort(byPriority);
  const next = linear.open.filter((issue) => issue.state.type === 'unstarted' && !linked(issue)).sort(byPriority).slice(0, 10);
  const finished = tasks.filter((task) => task.state === 'done' && task.updatedAt >= midnight);
  const section = (title, rows, blank) => [header(title), ...(rows.length ? rows : [note(blank, 'dim')]), note('')];
  return [
    ...section('In progress', [...active.sort((a, b) => rank(a.state) - rank(b.state)).map((task) => taskRow(task, prs)), ...started.map((issue) => issueRow(issue, tasks))], 'Nothing in flight.'),
    ...section('Up next', next.map((issue) => issueRow(issue, tasks)), empty ? linear.message.split('\n')[0] : 'No todo issues waiting.'),
    ...section('Done today', [...finished.map((task) => taskRow(task, prs)), ...linear.done.map((issue) => issueRow(issue, tasks))], 'Nothing finished yet today.'),
  ];
}

export const selectable = (row) => row.kind === 'task' || row.kind === 'issue';

export function moveCursor(rows, cursor, step) {
  const indexes = rows.flatMap((row, index) => (selectable(row) ? [index] : []));
  if (!indexes.length) return -1;
  const position = indexes.indexOf(cursor);
  if (position === -1) return indexes[0];
  return indexes[Math.min(indexes.length - 1, Math.max(0, position + step))];
}

export function renderView({ tab, rows, cursor, status, capacity, counts }, width, height) {
  const fit = (text) => [...cleanText(text)].slice(0, Math.max(10, width)).join('');
  const tabs = TABS.map((name, index) => {
    const label = `${index + 1} ${name}${counts[index] === undefined ? '' : ` ${counts[index]}`}`;
    return index === tab ? `[${label}]` : ` ${label} `;
  }).join(' ');
  const agents = capacity ? `agents ${capacity.used}/${capacity.max}` : '';
  const top = `REX LINEAR  ${tabs}`;
  const body = Math.max(3, height - 5);
  const start = Math.max(0, Math.min(Math.max(0, cursor) - Math.floor(body / 2), rows.length - body));
  const visible = rows.slice(start, start + body);
  return [
    { text: fit(`${top}${' '.repeat(Math.max(2, width - top.length - agents.length))}${agents}`), tone: 'title' },
    { text: fit('─'.repeat(width)), tone: 'dim' },
    ...visible.map((row, index) => ({ text: fit(row.text), tone: row.tone, selected: start + index === cursor })),
    ...Array.from({ length: Math.max(0, body - visible.length) }, () => ({ text: '', tone: 'text' })),
    { text: fit('─'.repeat(width)), tone: 'dim' },
    { text: fit(status?.text ?? ''), tone: status?.tone ?? 'muted' },
    { text: fit('↑↓ move  enter launch/focus  o open PR  s send  r refresh  x stopped  tab/1-4 switch  esc close'), tone: 'dim' },
  ];
}

export function issueBrief(issue, branch) {
  const description = String(issue.description ?? '').replace(/[^\P{Cc}\n\t]/gu, ' ').trim().slice(0, 4000) || 'No description in Linear.';
  return [
    `Goal: Resolve ${issue.identifier}: ${cleanText(issue.title)}`,
    `Linear: ${issue.url}`,
    '',
    description,
    '',
    'Files: Change only the files this issue needs. Ask before touching anything outside that scope.',
    'Verification: Run the repository checks relevant to the changed code. Report the exact commands and their results.',
    `Commit: Commit on ${branch} with a conventional message. Do not push, open a PR or change the Linear issue.`,
    'Report: Summarize what changed, the files touched, the commit SHA, check results and anything you could not verify. Then call subagent_done.',
  ].join('\n');
}

export function launchParams(issue, { repo, base, brief }) {
  const branch = issue.branchName || `jal/${issue.identifier.toLowerCase()}`;
  return {
    name: issue.identifier.toLowerCase(), task: brief, cwd: repo,
    worktree: { branch, base },
    persistent: true, interactive: true, model: 'task:coding', thinking: 'medium',
  };
}

export async function defaultBase(repo, exec = run) {
  const { stdout } = await exec('git', ['-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', timeout: 10_000 });
  const base = stdout.trim();
  try {
    await exec('git', ['-C', repo, 'fetch', '--quiet', 'origin', base.replace(/^origin\//, '')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return { base };
  } catch {
    return { base, warning: `Could not fetch ${base}; using the local copy.` };
  }
}

export function capacityOf(tasks, origin, running, max) {
  const ids = new Set(tasks.filter((row) => row.originCwd === origin && row.persistent && !row.stopConfirmed).map((row) => row.id));
  for (const row of running) if (row.persistent) ids.add(row.id);
  return { used: ids.size, max };
}
