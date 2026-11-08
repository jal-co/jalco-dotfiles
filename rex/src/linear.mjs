import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { cleanText, sessionCwd } from './tasks.ts';

const run = promisify(execFile);
const reference = /^op:\/\/[^/\r\n]+\/[^/\r\n]+\/([^/\r\n]+\/)?[^/\r\n]+$/;

export const TABS = ['Issues', 'Backlog', 'Sessions', 'Today'];
const AGENT = {
  blocked: ['! blocked', 'red'],
  error: ['✕ error', 'red'],
  working: ['● working', 'yellow'],
  unknown: ['? unknown', 'yellow'],
  stopping: ['◌ stopping', 'dim'],
  idle: ['○ idle', 'dim'],
  done: ['✓ done', 'green'],
};
const order = [...Object.keys(AGENT), 'stopped'];
const rank = (state) => (order.includes(state) ? order.indexOf(state) : order.indexOf('unknown'));
const priority = (issue) => (issue.priority ? issue.priority : 5);
const byPriority = (a, b) => priority(a) - priority(b) || a.identifier.localeCompare(b.identifier, undefined, { numeric: true });

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
  const since = startOfYesterday(now.getTime());
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
  const cwd = sessionCwd(task.sessionFile);
  return cwd ? basename(cwd) : 'No checkout';
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

export const live = (task) => Boolean(task) && !task.stopConfirmed && task.state !== 'stopped';

export function startOfYesterday(now = Date.now()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  return day;
}

export function agentLabel({ task, pr, issue }) {
  const settled = !live(task) || ['done', 'idle'].includes(task.state);
  if (!settled) {
    const [text, tone] = AGENT[task.state] ?? AGENT.unknown;
    return { text, tone };
  }
  if (pr?.state === 'MERGED') return { text: 'merged', tone: 'magenta' };
  if (pr?.state === 'OPEN') return { text: 'in review', tone: 'blue' };
  if (issue?.state.type === 'completed' || task?.completed || task?.state === 'done') return { text: '✓ done', tone: 'green' };
  if (live(task)) return { text: '○ idle', tone: 'dim' };
  return { text: '', tone: 'dim' };
}

function issueItem(issue, data) {
  const task = linkedTask(issue, data.tasks);
  const pr = task && pullRequestFor(task, data.prs);
  return {
    kind: 'item', key: `i:${issue.identifier}`, id: issue.identifier, title: cleanText(issue.title),
    project: cleanText(issue.project?.name ?? issue.team.key), issue, task, pr, agent: agentLabel({ task, pr, issue }),
  };
}

function taskItem(task, data) {
  const issue = [...data.linear.open, ...data.linear.done].find((entry) => linkedTask(entry, [task]));
  const pr = pullRequestFor(task, data.prs);
  return {
    kind: 'item', key: `t:${task.id}`, id: issue?.identifier ?? cleanText(task.name),
    title: issue ? cleanText(issue.title) : cleanText(task.branch ?? task.reason ?? ''),
    project: projectOf(task, data.records), issue, task, pr, agent: agentLabel({ task, pr, issue }),
  };
}

function pullRequestItem(pr) {
  return {
    kind: 'item', key: `p:${pr.url}`, id: `#${pr.url.split('/').at(-1)}`, title: cleanText(pr.name),
    project: basename(pr.repositoryPath), pr, agent: agentLabel({ pr }),
  };
}

const note = (text, tone = 'dim') => ({ kind: 'note', text, tone });

function section(title, items, empty) {
  if (!items.length && !empty) return [];
  return [{ kind: 'section', title, count: items.length }, ...(items.length ? items : [note(empty)]), { kind: 'blank' }];
}

function grouped(items, key) {
  const groups = new Map();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, entries]) => section(name, entries));
}

export function brief(data, now = Date.now()) {
  const since = startOfYesterday(now).getTime();
  const started = data.linear.open.filter((issue) => issue.state.type === 'started').sort(byPriority).map((issue) => issueItem(issue, data));
  const claimed = new Set(started.flatMap((item) => (item.task ? [item.task.id] : [])));
  const active = data.tasks.filter((task) => live(task) && !['done', 'idle'].includes(task.state) && !claimed.has(task.id))
    .sort((a, b) => rank(a.state) - rank(b.state)).map((task) => taskItem(task, data));
  const next = data.linear.open.filter((issue) => issue.state.type === 'unstarted' && !live(linkedTask(issue, data.tasks)))
    .sort(byPriority).slice(0, 10).map((issue) => issueItem(issue, data));
  const finished = data.linear.done.map((issue) => issueItem(issue, data));
  const shown = new Set(finished.flatMap((item) => (item.task ? [item.task.id] : [])));
  const tasks = data.tasks.filter((task) => !shown.has(task.id) && (task.state === 'done' || task.completed) && task.updatedAt >= since)
    .map((task) => taskItem(task, data));
  for (const item of tasks) shown.add(item.task.id);
  const merged = data.prs.filter((pr) => pr.state === 'MERGED' && Date.parse(pr.mergedAt) >= since && !shown.has(pr.taskId)).map(pullRequestItem);
  return { inProgress: [...active, ...started], next, done: [...finished, ...tasks, ...merged] };
}

export function buildView(tab, data, { mode = 'brief', showStopped = false, now = Date.now() } = {}) {
  const unavailable = data.linear.status === 'ok' ? undefined : data.linear.message.split('\n').map((line) => note(line, data.linear.status === 'error' ? 'red' : 'yellow'));
  if (tab === 0 || tab === 1) {
    if (unavailable) return unavailable;
    if (tab === 0) {
      const of = (type) => data.linear.open.filter((issue) => issue.state.type === type).sort(byPriority).map((issue) => issueItem(issue, data));
      return [...section('In progress', of('started'), 'Nothing started.'), ...section('Todo', of('unstarted'), 'No todo issues.')];
    }
    const backlog = data.linear.open.filter((issue) => ['backlog', 'triage'].includes(issue.state.type)).sort(byPriority).map((issue) => issueItem(issue, data));
    return backlog.length ? grouped(backlog, (item) => item.project) : [note('Your backlog is empty.')];
  }
  if (tab === 2) {
    if (!data.tasks.length) return [note('No tracked Rex tasks yet.')];
    const shown = data.tasks.filter((task) => showStopped || live(task)).sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));
    const hidden = data.tasks.length - shown.length;
    return [...grouped(shown.map((task) => taskItem(task, data)), (item) => item.project),
      ...(hidden ? [note(`${hidden} stopped task${hidden === 1 ? '' : 's'} hidden · x shows them`)] : [])];
  }
  const { inProgress, next, done } = brief(data, now);
  if (mode === 'list') {
    const items = [...inProgress, ...next, ...done];
    return items.length ? items : [note('Nothing to show.')];
  }
  return [
    ...section('In progress', inProgress, 'Nothing in flight.'),
    ...section('Up next', next, unavailable ? data.linear.message.split('\n')[0] : 'No todo issues waiting.'),
    ...section('Done since yesterday', done, 'Nothing finished since yesterday.'),
  ];
}

export function moveCursor(rows, cursor, step) {
  const items = rows.flatMap((row, index) => (row.kind === 'item' ? [index] : []));
  if (!items.length) return -1;
  const position = items.indexOf(cursor);
  if (position === -1) return items[0];
  return items[Math.min(items.length - 1, Math.max(0, position + step))];
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
