import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { cleanText, sessionCwd } from './tasks.ts';

const run = promisify(execFile);
const reference = /^op:\/\/[^/\r\n]+\/[^/\r\n]+\/([^/\r\n]+\/)?[^/\r\n]+$/;

export const TABS = ['Inbox', 'Issues', 'Backlog', 'Sessions', 'Today', 'Archive'];
export const SEARCH_TAB = TABS.length;
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

const fields = 'identifier title url branchName priority description completedAt state { name type } team { key } project { name } attachments { nodes { url } }';

export function issueQuery(since) {
  return `query RexLinear {
  viewer {
    open: assignedIssues(first: 100, orderBy: updatedAt, filter: { state: { type: { in: ["triage", "backlog", "unstarted", "started"] } } }) { nodes { ${fields} } }
    done: assignedIssues(first: 50, orderBy: updatedAt, filter: { completedAt: { gte: ${JSON.stringify(since.toISOString())} } }) { nodes { ${fields} } }
  }
}`;
}

export async function graphql(token, query, variables, fetch = globalThis.fetch) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.startsWith('lin_api_') ? token : `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    throw new Error(`Linear API ${response.status}: ${cleanText(body.errors?.[0]?.message ?? response.statusText)}`);
  }
  return body.data;
}

export async function fetchIssues(token, { fetch = globalThis.fetch, now = new Date() } = {}) {
  const data = await graphql(token, issueQuery(startOfYesterday(now.getTime())), undefined, fetch);
  return { open: data.viewer.open.nodes, done: data.viewer.done.nodes };
}

export const issueReference = (text) => /(?:^|[/\s])([A-Za-z][A-Za-z0-9]{0,9}-\d{1,7})(?=$|[/\s?#])/.exec(String(text).trim())?.[1].toUpperCase();

export async function findIssues(token, text, fetch = globalThis.fetch) {
  const reference = issueReference(text);
  if (reference) {
    const data = await graphql(token, `query RexLinearIssue($id: String!) { issue(id: $id) { ${fields} } }`, { id: reference }, fetch).catch((error) => {
      if (/not found|Entity not found/i.test(error.message)) return { issue: null };
      throw error;
    });
    return data.issue ? [data.issue] : [];
  }
  const data = await graphql(token, `query RexLinearSearch($term: String!) { searchIssues(term: $term, first: 30) { nodes { ${fields} } } }`, { term: String(text).trim() }, fetch);
  return data.searchIssues.nodes;
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

const PROGRAM_STATES = new Set(['idle', 'working', 'blocked', 'done', 'error']);

export function applyProgramStatus(task, records) {
  const record = records?.find((entry) => entry.id === 'rex-task');
  if (!record || task.stopConfirmed) return task;
  const state = PROGRAM_STATES.has(record.state) ? record.state : 'idle';
  const reason = cleanText(record.msg) || task.reason;
  return { ...task, state, reason, live: true };
}

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
    return { text, tone, spin: task.state === 'working' };
  }
  if (issue?.state.type === 'completed') return { text: '✓ done', tone: 'green' };
  if (issue?.state.type === 'canceled') return { text: '– canceled', tone: 'dim' };
  if (pr?.state === 'MERGED') return { text: 'merged', tone: 'magenta' };
  if (pr?.state === 'OPEN') return { text: 'in review', tone: 'blue' };
  if (task?.completed || task?.state === 'done') return { text: '✓ done', tone: 'green' };
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

export function coordinatorAsk(entries) {
  const turns = entries.filter((entry) => entry.type === 'message' && ['user', 'assistant', 'toolResult'].includes(entry.message?.role));
  const last = turns.at(-1);
  if (last?.message.role !== 'assistant' || last.message.stopReason !== 'stop') return undefined;
  const content = last.message.content;
  const text = typeof content === 'string' ? content : (content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const question = paragraphs.slice(-2).reverse().find((paragraph) => paragraph.includes('?'));
  if (!question) return undefined;
  return { question: cleanText(question.replace(/[*_`#>]/g, '')).slice(0, 400), at: last.timestamp };
}

const coordinatorItems = (coordinator) => [
  ...(coordinator?.dialog ? [{ kind: 'item', key: 'c:dialog', id: 'coordinator', title: `Waiting on a dialog: ${cleanText(coordinator.dialog)}`, project: '', agent: { text: '! dialog', tone: 'red' }, coordinator: { dialog: coordinator.dialog } }] : []),
  ...(coordinator?.ask ? [{ kind: 'item', key: `c:${coordinator.ask.at}`, id: 'coordinator', title: coordinator.ask.question, project: '', agent: { text: '? asks', tone: 'yellow' }, coordinator: { ask: coordinator.ask } }] : []),
];

export function inbox(data) {
  const shown = new Set();
  const pick = (filter, hint) => data.tasks.filter((task) => live(task) && !shown.has(task.id) && filter(task)).map((task) => {
    shown.add(task.id);
    return { ...taskItem(task, data), hint };
  });
  const waiting = (task) => ['OPEN', 'MERGED'].includes(pullRequestFor(task, data.prs)?.state);
  const asked = pick((task) => task.state === 'blocked', 'enter opens its tab to answer · s reply · h hide');
  const broken = pick((task) => ['error', 'unknown'].includes(task.state), 'u resume · d retire · D clean up · h hide');
  const review = pick((task) => task.state === 'done' && !waiting(task), 'enter opens its tab to review · s follow up · D clean up · h hide');
  const merged = data.prs.filter((pr) => pr.state === 'MERGED' && pr.cleanup === 'pending' && !shown.has(pr.taskId))
    .sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt))).map((pr) => {
      const task = data.tasks.find((row) => row.id === pr.taskId);
      if (task) shown.add(task.id);
      return { ...(task ? taskItem(task, data) : pullRequestItem(pr)), key: `p:${pr.url}`, pr, approval: true };
    });
  const coordinator = coordinatorItems(data.coordinator);
  return { coordinator, asked, broken, review, merged, count: coordinator.length + asked.length + broken.length + review.length + merged.length };
}

function archiveItem(row, data) {
  const issue = [...data.linear.open, ...data.linear.done].find((entry) => linkedTask(entry, [{ branch: row.branch }]));
  const reference = issue?.identifier ?? /(?:^|\/)([a-z][a-z0-9]{0,9}-\d{1,7})(?=-|$)/i.exec(String(row.branch))?.[1]?.toUpperCase();
  return {
    kind: 'item', key: `a:${row.id}`, id: reference ?? cleanText(row.name), title: cleanText(issue?.title ?? row.goal ?? row.name),
    project: basename(String(row.repository ?? '')), issue, archive: row,
    agent: { text: new Date(row.archivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: 'dim' },
  };
}

export function archiveView(data, { filter = '', now = Date.now() } = {}) {
  const needle = filter.toLowerCase();
  const items = (data.archive ?? []).map((row) => archiveItem(row, data))
    .filter((item) => !needle || [item.id, item.title, item.archive.name, item.archive.branch, item.archive.goal, ...(item.archive.pullRequests ?? [])].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  if (!items.length) return [note(needle ? `Nothing archived matches “${cleanText(filter)}”.` : 'Nothing archived yet. Cleaning up a task archives its conversation here.')];
  const today = new Date(now).setHours(0, 0, 0, 0);
  const week = today - 6 * 86_400_000;
  const when = (item) => Date.parse(item.archive.archivedAt);
  return [
    ...section('Archived today', items.filter((item) => when(item) >= today)),
    ...section('Earlier this week', items.filter((item) => when(item) < today && when(item) >= week)),
    ...section('Older', items.filter((item) => when(item) < week)),
  ];
}

export function buildView(tab, data, { mode = 'brief', showStopped = false, now = Date.now(), search, filter } = {}) {
  if (tab === TABS.length - 1) return archiveView(data, { filter, now });
  if (tab === 0) {
    const { coordinator, asked, broken, review, merged, count } = inbox(data);
    if (!count) return [note('Nothing needs you right now.')];
    return [...section('Coordinator asks', coordinator), ...section('Agents asking', asked), ...section('Approve cleanup', merged), ...section('Failed or crashed', broken), ...section('Ready for review', review)];
  }
  if (tab === SEARCH_TAB) {
    if (!search) return [note('Press / to search Linear or paste an issue link.')];
    if (search.status) return [note(search.status, search.tone ?? 'dim')];
    return search.issues.length ? section(`Results for “${cleanText(search.query)}”`, search.issues.map((issue) => issueItem(issue, data))) : [note(`No issues match “${cleanText(search.query)}”.`)];
  }
  tab -= 1;
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

export function withoutHidden(rows, hidden) {
  const out = [];
  let section;
  for (const row of rows) {
    if (row.kind === 'section') { section = { ...row, count: 0 }; out.push(section); continue; }
    if (row.kind === 'item' && hidden.has(row.key)) continue;
    if (row.kind === 'item' && section) section.count += 1;
    out.push(row);
  }
  return out.filter((row, index) => row.kind !== 'section' || row.count > 0 || out[index + 1]?.kind === 'note')
    .filter((row, index, kept) => row.kind !== 'blank' || (kept[index - 1] && kept[index - 1].kind !== 'blank'));
}

export function hiddenView(data, hidden, { search } = {}) {
  const seen = new Map();
  for (const tab of [...TABS.keys(), SEARCH_TAB]) {
    for (const row of buildView(tab, data, { showStopped: true, search })) if (row.kind === 'item' && hidden.has(row.key) && !seen.has(row.key)) seen.set(row.key, row);
  }
  return section('Hidden', [...seen.values()], 'Nothing hidden. Press h on a row to hide it.');
}

export const checkoutOf = (item) => item.task?.worktree ?? item.pr?.checkout;

export function moveCursor(rows, cursor, step) {
  const items = rows.flatMap((row, index) => (row.kind === 'item' ? [index] : []));
  if (!items.length) return -1;
  const position = items.indexOf(cursor);
  if (position === -1) return items[0];
  return items[Math.min(items.length - 1, Math.max(0, position + step))];
}

export function issueBrief(issue, branch) {
  const description = String(issue.description ?? '').replace(/[^\P{Cc}\n\t]/gu, ' ').trim().slice(0, 4000) || 'No description in Linear.';
  return taskBrief({ goal: `Resolve ${issue.identifier}: ${cleanText(issue.title)}`, context: [`Linear: ${issue.url}`, 'Tab: Your Rex tab is named after this issue. Keep that name.', '', description], branch, linear: true });
}

export function taskBrief({ goal, context = [], branch, linear = false }) {
  return [
    `Goal: ${goal}`,
    ...context,
    '',
    'Files: Change only the files this task needs. Ask before touching anything outside that scope.',
    'Verification: Run the repository checks relevant to the changed code. Report the exact commands and their results.',
    `Commit: Commit on ${branch} with a conventional message. Do not push${linear ? ', open a PR or change the Linear issue' : ' or open a PR'}.`,
    'Questions: Ask Justin questions and decisions in this session with ask_user_question and wait for his answer. Use caller_ping only when the coordinator must act.',
    'Report: Summarize what changed, the files touched, the commit SHA, check results and anything you could not verify. Then call subagent_done.',
  ].join('\n');
}

export function slugFor(goal, taken = []) {
  const filler = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'in', 'on', 'with', 'from', 'into', 'so', 'it', 'is', 'that', 'this']);
  const words = cleanText(goal).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word && !filler.has(word)).slice(0, 5);
  while (words.length > 1 && words.join('-').length > 32) words.pop();
  const base = words.join('-').slice(0, 32) || 'task';
  let slug = base;
  for (let index = 2; taken.includes(slug); index += 1) slug = `${base}-${index}`;
  return slug;
}

export const directCheckout = (repo) => repo === join(homedir(), 'dotfiles');

export function launchParams(subject, { repo, base, brief }) {
  const name = subject.name ?? subject.identifier.toLowerCase();
  const branch = subject.branchName || `jal/${name}`;
  return {
    name, task: brief, cwd: repo,
    worktree: directCheckout(repo) ? null : { branch, base },
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
