import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RexSurfaceProvider, callRex, surfaceTarget } from './provider.mjs';
import { PullRequestStore } from './pull-requests.mjs';
import { requestRoot, requestState, submitRequest, REQUEST_TTL } from './requests.mjs';
import { cleanText, TaskStore } from './tasks.ts';
import { RexWorktrees } from './worktrees.mjs';
import { loadPersistentConfig } from '../host/maestro/core/config/persistent-config.ts';
import { getSubagentsConfigDir, getSubagentsConfigExamplePath } from '../host/pi-extension/subagents/config-path.ts';
import {
  TABS, brief, buildView, capacityOf, defaultBase, findIssues, inbox, issueBrief, issueReference, launchParams, linkedTask, live,
  directCheckout, loadLinear, moveCursor, readLinearConfig, saveRepository, slugFor, taskBrief,
} from './linear.mjs';
import { confident, knownRepositories, rankRepositories } from './repositories.mjs';

const SGR = { bold: '1', dim: '2', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', selected: '48;5;236' };
const wide = /\p{Extended_Pictographic}|[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u;
const segmenter = new Intl.Segmenter();

export function columns(text) {
  let total = 0;
  for (const { segment } of segmenter.segment(text)) total += wide.test(segment) ? 2 : 1;
  return total;
}

export function fit(text, width) {
  if (width <= 0) return '';
  const clean = cleanText(text);
  if (columns(clean) <= width) return clean + ' '.repeat(width - columns(clean));
  let out = '';
  for (const { segment } of segmenter.segment(clean)) {
    if (columns(out + segment) > width - 1) break;
    out += segment;
  }
  return `${out}…${' '.repeat(width - 1 - columns(out))}`;
}

const paint = (text, styles = [], selected = false) => {
  const codes = [...styles, ...(selected ? ['selected'] : [])].filter(Boolean).map((style) => SGR[style]);
  return codes.length ? `\u001b[${codes.join(';')}m${text}\u001b[0m` : text;
};

const line = (cells, width, selected = false) => {
  let used = 0;
  let out = '';
  for (const [text, ...styles] of cells) {
    const room = width - used;
    if (room <= 0) break;
    const part = columns(text) > room ? fit(text, room) : text;
    out += paint(part, styles, selected);
    used += columns(part);
  }
  return out + paint(' '.repeat(Math.max(0, width - used)), [], selected);
};

function itemLine(item, width, selected, idWidth) {
  const agentWidth = 10;
  const projectWidth = width >= 90 ? 18 : 0;
  const titleWidth = Math.max(8, width - 2 - idWidth - 2 - projectWidth - 2 - agentWidth);
  return line([
    [selected ? '› ' : '  ', 'blue'],
    [`${fit(item.id, idWidth)}  `, 'dim'],
    [fit(item.title, titleWidth), selected ? 'bold' : ''],
    [projectWidth ? `  ${fit(item.project, projectWidth)}` : '', 'dim'],
    [`  ${fit(item.agent.text, agentWidth)}`, item.agent.tone],
  ], width, selected);
}

const keyline = (pairs) => pairs.flatMap(([key, label], index) => [[key, 'bold'], [` ${label}${index === pairs.length - 1 ? '' : ' · '}`, 'dim']]);
const LEGEND = [['n', 'new task'], ['c', 'coordinator'], ['/', 'search'], ['s', 'send'], ['u', 'resume'], ['d', 'retire'], ['q', 'quit']];

function detail(state, item) {
  const confirm = state.confirm;
  if (confirm?.kind === 'retire') {
    const { task } = confirm;
    const running = live(task) && task.state !== 'unknown';
    return [
      [[`${running ? 'Stop' : 'Retire'} ${task.name}?`, 'bold']],
      [[running ? `The agent is ${task.state}. It stops gracefully after its current step.` : `${cleanText(task.reason ?? 'Its process is unverified')}. Only a confirmed exit is retired.`, 'dim']],
      [['Logs, branch and checkout are kept. The tab closes and its agent slot is freed.', 'dim']],
      keyline([['enter', 'confirm'], ['esc', 'cancel']]),
    ];
  }
  if (confirm?.kind === 'launch') {
    const choice = confirm.choices[confirm.index];
    const next = confirm.choices[(confirm.index + 1) % confirm.choices.length];
    return [
      [[`Launch ${confirm.label} in ${choice.name}`, 'bold'], [confirm.index === 0 && confirm.sure ? '' : confirm.index === 0 ? '  best guess' : '  your pick', 'yellow']],
      [[`why: ${choice.reasons.join('; ')}${confirm.choices.length > 1 && next !== choice ? ` · next: ${next.name}` : ''}`, 'dim']],
      [[`${directCheckout(choice.path) ? 'directly in the checkout, no worktree' : `${confirm.branch} from ${confirm.base ?? '…'}`} · ${confirm.brief.split('\n')[0]}`, 'dim']],
      state.status?.text ? [[state.status.text, state.status.tone]] : keyline([['enter', 'launch'], ['tab', 'other repo'], ['t', 'type a path'], ['e', 'edit brief'], ['esc', 'cancel']]),
    ];
  }
  const last = state.prompt
    ? [[`${state.prompt.label} › `, 'blue'], [`${state.prompt.value.length > 60 ? `…${state.prompt.value.slice(-60)}` : state.prompt.value}▏`]]
    : state.status?.text ? [[state.status.text, state.status.tone]] : item?.hint ? [[item.hint, 'blue']] : keyline(LEGEND);
  if (!item) return [[], [], [], last];
  const facts = [item.id, item.issue?.state.name, item.project, item.task?.branch ?? item.issue?.branchName].filter(Boolean).join(' · ');
  const agent = item.task
    ? `agent: ${item.task.state ?? 'unknown'}${item.task.reason ? ` · ${cleanText(item.task.reason)}` : ''}${item.pr ? ` · PR ${item.pr.state.toLowerCase()}` : ''}`
    : item.pr ? `PR ${item.pr.state.toLowerCase()} · ${item.pr.url}` : 'agent: none · enter launches one';
  return [[[item.title, 'bold']], [[facts, 'dim']], [[agent, 'dim']], last];
}

export function renderScreen(state, width, height) {
  const names = [...TABS, ...(state.search ? ['Search'] : [])];
  const labels = names.map((name, index) => `${index + 1} ${name}${index === 0 && state.inboxCount ? ` ${state.inboxCount}` : ''}`);
  const tabs = labels.flatMap((label, index) => [[label, index === state.tab ? 'blue' : 'dim', index === state.tab ? 'bold' : ''], ['   ']]);
  const right = `● ${state.working} working   agents ${state.capacity.used}/${state.capacity.max}`;
  const tabWidth = labels.reduce((sum, label) => sum + columns(label) + 3, 0);
  const gap = width - tabWidth - columns(right);
  const header = gap >= 1
    ? line([...tabs, [' '.repeat(gap)], ['● ', 'yellow'], [right.slice(2), 'dim']], width)
    : line(tabs, width);
  const title = state.tab === 4
    ? line([['Brief', state.mode === 'brief' ? 'blue' : 'dim', 'bold'], ['  '], ['List', state.mode === 'list' ? 'blue' : 'dim', 'bold']], width)
    : line([[names[state.tab], 'bold']], width);
  const date = new Date(state.now).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hint = line([[`${date} · ${state.doneCount} done since yesterday · enter launch/focus or open PR · o open${state.tab === 4 ? ' · ←→ brief' : ''}`, 'dim']], width);
  const ids = state.rows.filter((row) => row.kind === 'item').map((row) => columns(row.id));
  const idWidth = Math.min(22, Math.max(8, ...ids));
  const body = Math.max(1, height - 10);
  const start = Math.max(0, Math.min(Math.max(0, state.cursor) - Math.floor(body / 2), state.rows.length - body));
  const rows = state.rows.slice(start, start + body).map((row, offset) => {
    if (row.kind === 'item') return itemLine(row, width, start + offset === state.cursor, idWidth);
    if (row.kind === 'section') return line([['  '], [row.title, 'bold'], [` ${row.count}`, 'dim']], width);
    if (row.kind === 'note') return line([['  '], [row.text, row.tone]], width);
    return line([], width);
  });
  const selected = state.rows[state.cursor];
  return [
    header, line([], width), title, hint, line([], width),
    ...rows, ...Array.from({ length: body - rows.length }, () => line([], width)),
    line([['─'.repeat(width), 'dim']], width),
    ...detail(state, selected?.kind === 'item' ? selected : undefined).map((cells) => line(cells, width)),
  ];
}

export function keys(data) {
  return data.match(/\u001b\[[0-9;]*[A-Za-z~]|\u001bO[A-Za-z]|\u001b|[\s\S]/gu) ?? [];
}

const KEY = { '\u001b[A': 'up', '\u001bOA': 'up', '\u001b[B': 'down', '\u001bOB': 'down', '\u001b[C': 'right', '\u001b[D': 'left', '\r': 'enter', '\n': 'enter', '\t': 'tab', '\u001b[Z': 'shift-tab', '\u001b': 'escape', '\u0003': 'ctrl-c', '\u007f': 'backspace', '\u001b[5~': 'page-up', '\u001b[6~': 'page-down' };

export class LinearApp {
  constructor({ origin = process.env.REX_COORDINATOR_CWD ?? join(homedir(), 'rex-coord'), output = process.stdout, input = process.stdin } = {}) {
    Object.assign(this, { origin, output, input });
    this.state = { tab: 4, mode: 'brief', showStopped: false, selected: {}, rows: [], cursor: -1 };
    this.linear = { status: 'loading', message: 'Loading Linear issues…', open: [], done: [] };
    this.pending = new Map();
    this.bases = new Map();
    this.data = this.snapshot();
    if (inbox(this.view()).count) this.state.tab = 0;
  }

  view() { return { ...this.data, linear: this.linear }; }

  snapshot() {
    try {
      return {
        tasks: new TaskStore().list().filter((task) => task.originCwd === this.origin),
        prs: new PullRequestStore().list(this.origin),
        records: new RexWorktrees(null).records(),
      };
    } catch (error) {
      this.state.status = { tone: 'red', text: `Task registry unreadable: ${cleanText(error.message)}` };
      return { tasks: [], prs: [], records: [] };
    }
  }

  async refreshLinear() {
    this.linear = await loadLinear({ token: this.linear.token });
    this.draw();
  }

  layout() {
    const data = this.view();
    const { state } = this;
    state.rows = buildView(state.tab, data, { mode: state.tab === 4 ? state.mode : 'brief', showStopped: state.showStopped, search: state.search });
    const found = state.rows.findIndex((row) => row.kind === 'item' && row.key === state.selected[state.tab]);
    state.cursor = found === -1 ? moveCursor(state.rows, -1, 0) : found;
    this.remember();
    state.doneCount = brief(data).done.length;
    state.inboxCount = inbox(data).count;
    state.working = this.data.tasks.filter((task) => live(task) && task.state === 'working').length;
    state.capacity = capacityOf(this.data.tasks, this.origin, [], readMaxAgents());
    state.now = Date.now();
  }

  remember() {
    const row = this.state.rows[this.state.cursor];
    if (row?.kind === 'item') this.state.selected[this.state.tab] = row.key;
  }

  draw() {
    if (this.paused) return;
    this.layout();
    const width = this.output.columns ?? 100;
    const height = this.output.rows ?? 30;
    this.output.write(`\u001b[H${renderScreen(this.state, width, height).join('\r\n')}\u001b[J`);
  }

  status(tone, text) { this.state.status = text ? { tone, text } : undefined; this.draw(); }

  start() {
    this.output.write('\u001b[?1049h\u001b[?25l');
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on('data', (data) => { for (const key of keys(data.toString('utf8'))) this.key(KEY[key] ?? key); });
    this.output.on('resize', () => this.draw());
    const refresh = () => { if (this.timer) return; this.timer = setTimeout(() => { this.timer = undefined; this.data = this.snapshot(); this.draw(); }, 150); };
    this.watchers = [new TaskStore().root, new PullRequestStore().root].map((root) => {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const watcher = watch(root, refresh);
      watcher.on('error', () => watcher.close());
      return watcher;
    });
    this.poll = setInterval(() => this.checkRequests(), 500);
    this.reload = setInterval(() => { void this.refreshLinear(); }, 5 * 60_000);
    for (const signal of ['SIGTERM', 'SIGHUP']) process.once(signal, () => { this.stop(); process.exit(0); });
    this.draw();
    void this.refreshLinear();
  }

  stop() {
    for (const watcher of this.watchers ?? []) watcher.close();
    clearInterval(this.poll);
    clearInterval(this.reload);
    clearTimeout(this.timer);
    this.input.setRawMode?.(false);
    this.input.pause();
    this.output.write('\u001b[?25h\u001b[?1049l');
  }

  key(name) {
    try {
      if (this.state.prompt) return this.promptKey(name);
      if (this.state.confirm) return this.confirmKey(name);
      this.listKey(name);
    } catch (error) {
      this.status('red', cleanText(error.message));
    }
  }

  ask(label, submit, value = '') {
    this.state.prompt = { label, value, submit };
    this.state.status = undefined;
    this.draw();
  }

  promptKey(name) {
    const prompt = this.state.prompt;
    if (name === 'escape' || name === 'ctrl-c') { this.state.prompt = undefined; return this.status('dim', 'Cancelled.'); }
    if (name === 'enter') { this.state.prompt = undefined; this.draw(); return prompt.submit(prompt.value.trim()); }
    if (name === 'backspace') prompt.value = [...prompt.value].slice(0, -1).join('');
    else if (name.length && !name.startsWith('\u001b') && !/[\p{Cc}]/u.test(name)) prompt.value += name;
    this.draw();
  }

  confirmKey(name) {
    const confirm = this.state.confirm;
    if (name === 'escape' || name === 'ctrl-c' || name === 'q') { this.state.confirm = undefined; return this.status('dim', 'Cancelled.'); }
    if (confirm.kind === 'retire') {
      if (name !== 'enter') return;
      this.state.confirm = undefined;
      return this.request('stop', { id: confirm.task.logicalId ?? confirm.task.id }, `Asked the coordinator to stop ${confirm.task.name}…`);
    }
    if (name === 'tab' && confirm.choices.length > 1) { confirm.index = (confirm.index + 1) % confirm.choices.length; return this.prepare(); }
    if (name === 't') return this.ask('repository path', (path) => this.typedRepository(confirm, path), join(homedir(), 'dev', ''));
    if (name === 'e') { confirm.brief = this.edit(confirm.brief); return this.draw(); }
    if (name !== 'enter') return;
    if (!confirm.base) return this.status('yellow', 'Still fetching the base branch…');
    if (!confirm.brief.trim()) { this.state.confirm = undefined; return this.status('dim', 'Empty brief; nothing launched.'); }
    const choice = confirm.choices[confirm.index];
    this.state.confirm = undefined;
    if (confirm.subject.team?.key) saveRepository(confirm.subject.team.key, choice.path);
    const params = launchParams(confirm.subject, { repo: choice.path, base: confirm.base, brief: confirm.brief });
    this.request('launch', params, `Asked the coordinator to launch ${params.name} in ${choice.name}${confirm.warning ? `. ${confirm.warning}` : ''}…`);
  }

  listKey(name) {
    const { state } = this;
    const count = TABS.length + (state.search ? 1 : 0);
    if (name === 'q' || name === 'escape' || name === 'ctrl-c') { this.stop(); process.exit(0); }
    if (['up', 'down', 'k', 'j', 'page-up', 'page-down'].includes(name)) {
      state.cursor = moveCursor(state.rows, state.cursor, { up: -1, k: -1, down: 1, j: 1, 'page-up': -10, 'page-down': 10 }[name]);
      this.remember();
      return this.draw();
    }
    if ((/^[1-6]$/.test(name) && Number(name) <= count) || name === 'tab' || name === 'shift-tab') {
      state.tab = /^[1-6]$/.test(name) ? Number(name) - 1 : (state.tab + (name === 'tab' ? 1 : count - 1)) % count;
      state.status = undefined;
      return this.draw();
    }
    if ((name === 'left' || name === 'right') && state.tab === 4) { state.mode = state.mode === 'brief' ? 'list' : 'brief'; return this.draw(); }
    if (name === 'x') { state.showStopped = !state.showStopped; return this.draw(); }
    if (name === 'r') {
      this.data = this.snapshot();
      this.status('dim', 'Refreshing…');
      return void this.refreshLinear().then(() => this.status(this.linear.status === 'ok' ? 'dim' : 'yellow', this.linear.status === 'ok' ? `Refreshed ${new Date().toLocaleTimeString()}.` : this.linear.message.split('\n')[0]));
    }
    const item = state.rows[state.cursor]?.kind === 'item' ? state.rows[state.cursor] : undefined;
    if (name === 'n') return this.ask('new task, what should it do?', (goal) => this.newTask(goal));
    if (name === '/') return this.ask('search Linear or paste an issue link', (text) => this.search(text));
    if (name === 'c') {
      const cleanup = item?.pr?.state === 'MERGED' && item.pr.cleanup === 'pending' ? `Clean up ${item.task?.name ?? 'the task'} now that ${item.pr.url} is merged.` : '';
      return this.ask('coordinator', (message) => (message ? this.request('message', { message }, 'Sending to the coordinator…') : this.status('dim', 'Nothing sent.')), cleanup);
    }
    if (!item) return;
    if (name === 'enter') return this.enter(item);
    if (name === 'o') return this.open(item.pr?.url ?? item.issue?.url, item.id);
    if (name === 's') return this.send(item);
    if (name === 'd') return this.retire(item);
    if (name === 'u') return this.resume(item);
  }

  enter(item) {
    if (live(item.task)) return this.focus(item.task);
    if (item.pr) return this.open(item.pr.url, item.id);
    if (item.issue && !['completed', 'canceled'].includes(item.issue.state.type)) return this.startLaunch(item.issue);
    if (item.issue) return this.open(item.issue.url, item.id);
    this.status('yellow', `${item.id} is stopped. Press u to resume it.`);
  }

  focus(task) {
    const window = new RexSurfaceProvider().windowOf(task.surface);
    if (!window) return this.status('yellow', `${task.name}'s tab is closed. Press u to resume it in a new tab.`);
    callRex(['do', 'session.select', '--args', JSON.stringify({ session_id: surfaceTarget(task.surface).session, window_id: window })]);
    this.status('green', `Focused ${task.name}.`);
  }

  open(url, label) {
    if (!/^https:\/\/\S+$/.test(url ?? '')) return this.status('yellow', `${label} has no link to open.`);
    execFile('open', [url], (error) => { if (error) this.status('red', `Could not open ${url}`); });
    this.status('green', `Opened ${url}`);
  }

  send(item) {
    if (!live(item.task)) return this.status('yellow', item.task ? `${item.task.name} is stopped; nothing to send to.` : `${item.id} has no running agent. Press enter to launch one.`);
    const { task } = item;
    this.ask(`message ${task.name}`, (message) => (message
      ? this.request('send', { id: task.logicalId ?? task.id, message }, `Sending to ${task.name}…`)
      : this.status('dim', 'Nothing sent.')));
  }

  resume(item) {
    if (!item.task) return this.status('yellow', `${item.id} has no agent to resume.`);
    if (item.task.stopConfirmed) return this.status('yellow', `${item.task.name} was retired and its tab closed. Launch a new task instead.`);
    if (live(item.task) && item.task.state !== 'unknown') return this.status('yellow', `${item.task.name} is ${item.task.state}. Use s to send it a message.`);
    this.request('resume', { id: item.task.logicalId ?? item.task.id }, `Asked the coordinator to resume ${item.task.name}…`);
  }

  retire(item) {
    if (!item.task) return this.status('yellow', `${item.id} has no agent to retire.`);
    if (item.task.stopConfirmed) return this.status('dim', `${item.task.name} is already retired.`);
    this.state.confirm = { kind: 'retire', task: item.task };
    this.draw();
  }

  newTask(goal) {
    if (!goal) return this.status('dim', 'Nothing launched.');
    const name = slugFor(goal, this.data.tasks.filter(live).map((task) => task.name));
    this.startLaunch({ title: goal, name, branchName: `jal/${name}` });
  }

  async search(text) {
    if (!text) return this.status('dim', 'Nothing searched.');
    if (!this.linear.token) return this.status('yellow', this.linear.message?.split('\n')[0] ?? 'Linear is still loading.');
    this.state.search = { query: text, status: 'Searching Linear…' };
    this.state.tab = 5;
    this.draw();
    try {
      const issues = await findIssues(this.linear.token, text);
      this.state.search = { query: issueReference(text) ?? text, issues };
      this.state.selected[5] = undefined;
      const [only] = issues;
      if (issueReference(text) && issues.length === 1 && !live(linkedTask(only, this.data.tasks)) && !['completed', 'canceled'].includes(only.state.type)) return this.startLaunch(only);
      this.status('dim', issues.length ? `${issues.length} result${issues.length === 1 ? '' : 's'}. Enter takes one on.` : '');
    } catch (error) {
      this.state.search = { query: text, status: cleanText(error.message), tone: 'red' };
      this.draw();
    }
  }

  startLaunch(subject) {
    this.launch(subject).catch((error) => { this.state.confirm = undefined; this.status('red', cleanText(error.message)); });
  }

  async launch(subject) {
    const capacity = capacityOf(this.data.tasks, this.origin, [], readMaxAgents());
    const label = subject.identifier ?? subject.name;
    if (capacity.used >= capacity.max) return this.status('red', `Agent cap reached (${capacity.used}/${capacity.max}). Retire a task with d before launching ${label}.`);
    this.status('dim', `Working out where ${label} belongs…`);
    const config = readLinearConfig();
    const choices = await rankRepositories(subject, {
      candidates: knownRepositories({ records: this.data.records, config }),
      tasks: this.data.tasks, records: this.data.records, issues: [...this.linear.open, ...this.linear.done], config,
    });
    const branch = launchParams(subject, { repo: '', base: '', brief: '' }).worktree.branch;
    const brief = subject.identifier ? issueBrief(subject, branch) : taskBrief({ goal: subject.title, branch });
    const confirm = { kind: 'launch', subject, label, branch, brief, choices, index: 0, sure: confident(choices) };
    if (!choices.length) return this.ask('repository path', (path) => this.typedRepository(confirm, path), join(homedir(), 'dev', ''));
    this.state.confirm = confirm;
    return this.prepare();
  }

  typedRepository(confirm, path) {
    if (!path || !isAbsolute(path) || !existsSync(join(path, '.git'))) return this.status('red', `${path || 'That path'} is not a Git checkout.`);
    const existing = confirm.choices.findIndex((choice) => choice.path === path);
    if (existing === -1) confirm.choices.unshift({ path, name: basename(path), reasons: ['you typed it'] });
    confirm.index = existing === -1 ? 0 : existing;
    confirm.sure = true;
    this.state.confirm = confirm;
    return this.prepare();
  }

  async prepare() {
    const confirm = this.state.confirm;
    const choice = confirm.choices[confirm.index];
    confirm.base = undefined;
    confirm.warning = undefined;
    this.status('dim', `Fetching ${choice.name}'s default branch…`);
    if (!this.bases.has(choice.path)) this.bases.set(choice.path, defaultBase(choice.path));
    let result;
    try { result = await this.bases.get(choice.path); } catch (error) {
      this.bases.delete(choice.path);
      return this.status('red', `${choice.name} has no origin/HEAD (${cleanText(error.message).slice(0, 80)}). Press tab for another repository.`);
    }
    if (this.state.confirm !== confirm || confirm.choices[confirm.index] !== choice) return undefined;
    Object.assign(confirm, result);
    this.status('dim', '');
  }

  edit(text) {
    const directory = mkdtempSync(join(tmpdir(), 'rex-linear-brief-'));
    const file = join(directory, 'brief.md');
    writeFileSync(file, text, { mode: 0o600 });
    this.paused = true;
    this.input.setRawMode?.(false);
    this.output.write('\u001b[?25h\u001b[?1049l');
    try {
      spawnSync(process.env.VISUAL || process.env.EDITOR || 'vi', [file], { stdio: 'inherit' });
      return readFileSync(file, 'utf8');
    } finally {
      rmSync(directory, { recursive: true, force: true });
      this.output.write('\u001b[?1049h\u001b[?25l');
      this.input.setRawMode?.(true);
      this.paused = false;
    }
  }

  request(action, params, message) {
    const id = submitRequest({ origin: this.origin, action, params });
    this.pending.set(id, { at: Date.now(), warned: false });
    this.status('dim', message);
  }

  checkRequests() {
    for (const [id, entry] of this.pending) {
      const result = requestState(id, requestRoot());
      if (result.state === 'done') {
        this.pending.delete(id);
        this.data = this.snapshot();
        this.status(result.ok ? (result.outcome === 'queued' ? 'yellow' : 'green') : 'red', result.text || (result.ok ? 'Done.' : 'Failed.'));
      } else if (result.state === 'queued' && !entry.warned && Date.now() - entry.at > 10_000) {
        entry.warned = true;
        this.status('yellow', `The coordinator hasn't picked this up. Run pinned, or /reload it. The request expires ${REQUEST_TTL / 1000}s after sending.`);
      }
    }
  }
}

const readMaxAgents = () => loadPersistentConfig(getSubagentsConfigDir(), getSubagentsConfigExamplePath()).maxAgents;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.stdout.isTTY) throw new Error('rex-linear needs an interactive terminal.');
  const app = new LinearApp();
  process.on('uncaughtException', (error) => { app.stop(); console.error(error); process.exit(1); });
  app.start();
}
