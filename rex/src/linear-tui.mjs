import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { decodeKittyPrintable, Editor, Input, matchesKey, ProcessTerminal, truncateToWidth, TuiAltScreen, visibleWidth } from '@earendil-works/pi-tui';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RexSurfaceProvider, callRex, rexBinary, surfaceTarget } from './provider.ts';
import { PullRequestStore } from './pull-request-watcher.ts';
import { orphanResults, requestRoot, requestState, submitRequest, REQUEST_TTL } from './requests.ts';
import { cleanText, TaskStore } from './tasks.ts';
import { TaskHistory } from './history.ts';
import { RexWorktrees } from './worktrees.ts';
import { loadPersistentConfig } from '../host/maestro/core/config/persistent-config.ts';
import { getSubagentsConfigDir, getSubagentsConfigExamplePath } from '../host/pi-extension/subagents/config-path.ts';
import {
  SEARCH_TAB, TABS, applyProgramStatus, coordinatorAsk, brief, buildView, capacityOf, checkoutOf, defaultBase, findIssues, hiddenView, inbox, issueBrief, issueReference, launchParams, linkedTask, live,
  createProject, directCheckout, loadLinear, moveCursor, readLinearConfig, saveRepository, slugFor, stashed, taskBrief, withoutHidden,
} from './linear.mjs';
import { confident, knownRepositories, rankRepositories } from './repositories.mjs';

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SGR = { bold: '1', dim: '2', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', selected: '48;5;236', tab: '48;5;237' };
export const columns = visibleWidth;

export function fit(text, width) {
  if (width <= 0) return '';
  return truncateToWidth(cleanText(text), width, '…', true).replaceAll('\u001b[0m', '');
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

function itemLine(item, width, selected, idWidth, spinner = '●') {
  const agentWidth = 10;
  const projectWidth = width >= 90 ? 18 : 0;
  const titleWidth = Math.max(8, width - 2 - idWidth - 2 - projectWidth - 2 - agentWidth);
  return line([
    [selected ? '› ' : '  ', 'blue'],
    [`${fit(item.id, idWidth)}  `, 'dim'],
    [fit(item.title, titleWidth), selected ? 'bold' : ''],
    [projectWidth ? `  ${fit(item.project, projectWidth)}` : '', 'dim'],
    [`  ${fit(item.agent.spin ? `${spinner} working` : item.agent.text, agentWidth)}`, item.agent.tone],
  ], width, selected);
}

const keyline = (pairs) => pairs.flatMap(([key, label], index) => [[key, 'bold'], [` ${label}${index === pairs.length - 1 ? '' : ' · '}`, 'dim']]);
const HELP = [
  ['↑ ↓  j k', 'move'],
  ['tab  1-7', 'switch tabs'],
  ['← →', 'brief or list on Today'],
  ['enter', 'focus, open PR or launch'],
  ['n', 'new task from a goal'],
  ['/', 'search or paste a link'],
  ['c', 'type to the coordinator'],
  ['s', 'message the selected agent'],
  ['u', 'resume a crashed or stashed agent'],
  ['z', 'stash: stop the agent, keep everything to resume later'],
  ['d', 'stop or retire the agent'],
  ['D', 'stop, remove checkout'],
  ['a', 'clean up all merged'],
  ['h', 'hide, or unhide in Hidden'],
  ['H', 'open or close Hidden'],
  ['N', 'launch: start a new project in ~/dev'],
  ['enter', 'Archive: reopen the conversation'],
  ['v', 'Archive: read the transcript'],
  ['y', 'answer the coordinator yes'],
  ['K', 'keep a merged task, no cleanup'],
  ['o', 'open PR or Linear issue'],
  ['l', 'open the Linear issue'],
  ['r', 'refresh Linear and tasks'],
  ['x', 'show or hide stopped tasks'],
  ['?', 'show or hide this list'],
  ['q  ctrl+c', 'quit'],
  ['esc', 'cancel; never quits'],
];

export function legend(state) {
  if (state.help) return [['any key', 'close this list']];
  if (state.prompt?.kind === 'editor') return [['enter', state.prompt.verb ?? 'send'], ['shift+enter', 'new line'], ['esc', 'cancel']];
  if (state.prompt) return [['enter', state.prompt.verb ?? 'submit'], ['esc', 'cancel']];
  if (state.confirm?.kind === 'retire') return [['enter', 'confirm'], ['esc', 'cancel']];
  if (state.confirm?.kind === 'cleanup') return [['enter', 'clean up'], ['p', 'keep uncommitted work as a commit'], ['esc', 'cancel']];
  if (state.confirm) return [['enter', 'launch'], ['tab', 'other repo'], ['N', 'new project'], ['t', 'type a path'], ['e', 'edit brief'], ['esc', 'cancel']];
  const selected = state.rows?.[state.cursor];
  const item = selected?.kind === 'item' ? selected : undefined;
  if (state.hiddenView) return [...(item ? [['h', 'unhide']] : []), ['H', 'back'], ['?', 'all keys'], ['q', 'quit']];
  const actions = item ? actionsFor(item, state.records ?? []) : [];
  const globals = [['?', 'all keys'], ['n', 'new'], ['/', state.tab === TABS.length - 1 ? 'filter' : 'search'], ['c', 'coordinator'], ['H', 'hidden'], ['r', 'refresh'], ['q', 'quit']];
  return [...actions, ...globals.filter(([key]) => !actions.some(([taken]) => taken === key))];
}

export function enterAction(item) {
  if (item.archive) return 'recall';
  if (item.coordinator) return item.coordinator.dialog ? 'open coordinator' : 'answer';
  if (item.approval) return 'approve cleanup';
  if (stashed(item.task)) return 'resume';
  if (live(item.task)) return item.task.state === 'blocked' ? 'answer' : 'focus';
  if (item.pr) return 'open PR';
  if (item.issue && !['completed', 'canceled'].includes(item.issue.state.type)) return 'launch';
  if (item.issue) return 'open issue';
  return undefined;
}

export function actionsFor(item, records) {
  if (item.coordinator) return [['enter', enterAction(item)], ...(item.coordinator.ask ? [['y', 'yes']] : []), ['h', 'hide']];
  if (item.approval) return [['enter', 'approve cleanup'], ['K', 'keep, no cleanup'], ['o', 'PR'], ...(item.issue ? [['l', 'Linear']] : []), ['h', 'hide']];
  if (item.archive) return [['enter', 'recall'], ['v', 'view transcript'], ...(item.archive.pullRequests?.length ? [['o', 'PR']] : []), ...(item.issue ? [['l', 'Linear']] : []), ['h', 'hide']];
  const task = item.task;
  const running = live(task) && !['unknown', 'error'].includes(task.state);
  const checkout = checkoutOf(item);
  const cleanable = checkout && (task?.id ?? item.pr?.taskId) && records.some((record) => record.path === checkout && !record.removed);
  const enter = enterAction(item);
  return [
    ...(enter ? [['enter', enter]] : []),
    ...(running ? [['s', 'send']] : []),
    ...(task && !task.stopConfirmed && !running ? [['u', 'resume']] : []),
    ...(running && !task.stashed ? [['z', 'stash']] : []),
    ...(cleanable ? [['D', 'clean up']] : []),
    ...(task && !task.stopConfirmed ? [['d', running ? 'stop' : 'retire']] : []),
    ...(item.pr?.state === 'MERGED' && item.pr.cleanup === 'pending' ? [['a', 'clean up all merged']] : []),
    ...(item.pr ? [['o', 'PR']] : item.issue ? [['o', 'issue']] : []),
    ...(item.issue && item.pr ? [['l', 'Linear']] : []),
    ['h', 'hide'],
  ];
}

function detail(state, item) {
  const confirm = state.confirm;
  if (confirm?.kind === 'retire') {
    const { task } = confirm;
    const running = live(task) && task.state !== 'unknown';
    return [
      [[`${running ? 'Stop' : 'Retire'} ${task.name}?`, 'bold']],
      [[running ? `The agent is ${task.state}. It stops gracefully after its current step.` : `${cleanText(task.reason ?? 'Its process is unverified')}. Only a confirmed exit is retired.`, 'dim']],
      [['Logs, branch and checkout are kept. The tab closes and its agent slot is freed.', 'dim']],
      state.status?.text ? [[state.status.text, state.status.tone]] : [],
    ];
  }
  if (confirm?.kind === 'cleanup') {
    const [first] = confirm.items;
    const label = first.task?.name ?? first.id;
    return [
      [[confirm.items.length > 1 ? `Clean up ${confirm.items.length} merged tasks?` : `Clean up ${label}?`, 'bold']],
      [[confirm.items.length > 1 ? 'Each one: stop its agent if running, archive its logs, remove its checkout.' : `Stops its agent if running, archives its logs, removes ${checkoutOf(first)}.`, 'dim']],
      [['Branches and commits stay. Uncommitted work blocks removal unless you press p.', 'dim']],
      state.status?.text ? [[state.status.text, state.status.tone]] : [],
    ];
  }
  if (confirm?.kind === 'launch') {
    const choice = confirm.choices[confirm.index];
    const next = confirm.choices[(confirm.index + 1) % confirm.choices.length];
    return [
      [[`Launch ${confirm.label} in ${choice.name}`, 'bold'], [confirm.index === 0 && confirm.sure ? '' : confirm.index === 0 ? '  best guess' : '  your pick', 'yellow']],
      [[`why: ${choice.reasons.join('; ')}${confirm.choices.length > 1 && next !== choice ? ` · next: ${next.name}` : ''}`, 'dim']],
      [[`${confirm.direct ? 'directly in the checkout, no worktree' : `${confirm.branch} from ${confirm.base ?? '…'}`} · ${confirm.brief.split('\n')[0]}`, 'dim']],
      state.status?.text ? [[state.status.text, state.status.tone]] : [],
    ];
  }
  const last = state.status?.text ? [[state.status.text, state.status.tone]] : [];
  if (!item) return [[], [], [], last];
  if (item.coordinator) {
    return [
      [[item.coordinator.dialog ? 'The coordinator is waiting on a confirmation in its tab' : 'The coordinator is waiting for your answer', 'bold']],
      [[item.title, 'yellow']],
      [[item.coordinator.dialog ? 'enter opens its tab so you can answer there' : 'enter writes an answer · y replies yes · it arrives as if you typed it in the coordinator', 'dim']],
      last,
    ];
  }
  if (item.archive) {
    const { archive } = item;
    const pr = archive.pullRequests?.[0];
    return [
      [[item.title, 'bold']],
      [[[item.id, item.project, archive.branch].filter(Boolean).join(' · '), 'dim']],
      [[`archived ${new Date(archive.archivedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${pr ? ` · ${pr}` : ''} · ${archive.name}`, 'dim']],
      last,
    ];
  }
  const facts = [item.id, item.issue && `Linear: ${item.issue.state.name}`, item.pr && `PR ${item.pr.state.toLowerCase()}`, item.project, item.task?.branch ?? item.issue?.branchName].filter(Boolean).join(' · ');
  const agent = item.task
    ? `agent: ${item.task.state ?? 'unknown'}${item.task.reason ? ` · ${cleanText(item.task.reason)}` : ''}${item.pr ? ` · PR ${item.pr.state.toLowerCase()}` : ''}`
    : item.pr ? `PR ${item.pr.state.toLowerCase()} · ${item.pr.url}` : 'agent: none · enter launches one';
  return [[[item.title, 'bold']], [[facts, 'dim']], [[agent, 'dim']], last];
}

export function tabCells(state) {
  const names = [...TABS, ...(state.search ? ['Search'] : [])];
  return names.flatMap((name, index) => {
    const count = state.counts?.[index];
    const active = index === state.tab && !state.hiddenView;
    const urgent = index === 0 && count > 0;
    const cells = active
      ? [[` ${index + 1} ${name}${count ? ` ${count}` : ''} `, 'blue', 'bold', 'tab']]
      : [[` ${index + 1} `, 'dim'], [name, ''], [count ? ` ${count}` : '', urgent ? 'yellow' : 'dim'], [' ', '']];
    return [...cells, [' ', '']];
  });
}

export function renderScreen(state, width, height) {
  const names = [...TABS, ...(state.search ? ['Search'] : [])];
  const tabs = tabCells(state);
  const dead = state.slots?.dead ?? 0;
  const right = `● ${state.working} working   agents ${state.capacity.used}/${state.capacity.max}${dead ? ` · ${dead} dead` : ''}`;
  const tabWidth = tabs.reduce((sum, [text]) => sum + columns(text), 0);
  const gap = width - tabWidth - columns(right);
  const header = gap >= 1
    ? line([...tabs, [' '.repeat(gap)], [`${state.working ? state.spinner ?? '●' : '●'} `, 'yellow'], [`${state.working} working   agents ${state.capacity.used}/${state.capacity.max}`, 'dim'], [dead ? ` · ${dead} dead` : '', 'yellow']], width)
    : line(tabs, width);
  const title = state.hiddenView
    ? line([['Hidden', 'bold'], ['  rows you hid with h · h unhides · H goes back', 'dim']], width)
    : state.tab === 4
    ? line([['Brief', state.mode === 'brief' ? 'blue' : 'dim', 'bold'], ['  '], ['List', state.mode === 'list' ? 'blue' : 'dim', 'bold']], width)
    : state.tab === 3
    ? line([['Sessions', 'bold'], [`  agent slots ${state.capacity.used}/${state.capacity.max}: ${slotSummary(state.slots)}`, state.slots?.dead ? 'yellow' : 'dim']], width)
    : state.tab === TABS.length - 1
    ? line([['Archive', 'bold'], [state.archiveFilter ? `  filtered by “${state.archiveFilter}” · / changes it` : '  cleaned-up tasks and their conversations · / filters', 'dim']], width)
    : line([[names[state.tab], 'bold']], width);
  const date = new Date(state.now).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const hint = line([[`${date} · ${state.doneCount} done since yesterday · enter launch/focus or open PR · o open${state.tab === 4 ? ' · ←→ brief' : ''}`, 'dim']], width);
  const ids = state.rows.filter((row) => row.kind === 'item').map((row) => columns(row.id));
  const idWidth = Math.min(22, Math.max(8, ...ids));
  const selectedRow = state.rows[state.cursor];
  const selectedItem = selectedRow?.kind === 'item' ? selectedRow : undefined;
  const info = detail(state, selectedItem).map((cells) => line(cells, width));
  const promptLines = state.prompt ? state.prompt.component.render(width) : [];
  const detailLines = !state.prompt ? info
    : state.prompt.kind === 'editor' ? [line([[state.prompt.label, 'blue', 'bold']], width), ...promptLines]
    : [...info.slice(0, 3), ...promptLines];
  const body = Math.max(1, height - 7 - detailLines.length);
  const start = Math.max(0, Math.min(Math.max(0, state.cursor) - Math.floor(body / 2), state.rows.length - body));
  const keysLine = line(keyline(legend(state).filter((_pair, index, pairs) => columns(pairs.slice(0, index + 1).map(([key, label]) => `${key} ${label}`).join(' · ')) <= width)), width);
  if (state.help) {
    const helpWidth = Math.max(...HELP.map(([keys]) => columns(keys)));
    const room = height - 7;
    const split = HELP.length > room ? Math.ceil(HELP.length / 2) : HELP.length;
    const half = split < HELP.length ? Math.floor((width - 4) / 2) : width - 2;
    const cell = ([keys, text] = ['', '']) => [[fit(keys, helpWidth + 2), 'bold'], [fit(text, Math.max(0, half - helpWidth - 2)), 'dim']];
    const help = [line([['  '], ['Keys', 'bold']], width), ...HELP.slice(0, split).map((pair, index) => line([['  '], ...cell(pair), ...(split < HELP.length ? [['  '], ...cell(HELP[split + index])] : [])], width))].slice(0, height - 6);
    return [header, line([], width), title, hint, line([], width), ...help, ...Array.from({ length: height - 6 - help.length }, () => line([], width)), keysLine];
  }
  const rows = state.rows.slice(start, start + body).map((row, offset) => {
    if (row.kind === 'item') return itemLine(row, width, start + offset === state.cursor, idWidth, state.spinner);
    if (row.kind === 'section') return line([['  '], [row.title, 'bold'], [` ${row.count}`, 'dim']], width);
    if (row.kind === 'note') return line([['  '], [row.text, row.tone]], width);
    return line([], width);
  });
  return [
    header, line([], width), title, hint, line([], width),
    ...rows, ...Array.from({ length: body - rows.length }, () => line([], width)),
    line([['─'.repeat(width), 'dim']], width),
    ...detailLines,
    keysLine,
  ].slice(0, Math.max(height, 1));
}

const NAMED_KEYS = [['up', 'up'], ['down', 'down'], ['left', 'left'], ['right', 'right'], ['enter', 'enter'], ['shift+tab', 'shift-tab'], ['tab', 'tab'],
  ['escape', 'escape'], ['ctrl+c', 'ctrl-c'], ['pageUp', 'page-up'], ['pageDown', 'page-down'], ['backspace', 'backspace']];

export function keyName(data) {
  for (const [id, name] of NAMED_KEYS) if (matchesKey(data, id)) return name;
  return decodeKittyPrintable(data) ?? data;
}

const dim = (text) => `\u001b[2m${text}\u001b[0m`;
const editorTheme = {
  borderColor: dim,
  selectList: { selectedPrefix: (text) => text, selectedText: (text) => text, description: dim, scrollInfo: dim, noMatch: dim },
};

export class LinearApp {
  constructor({ origin = process.env.REX_COORDINATOR_CWD ?? join(homedir(), 'rex-coord') } = {}) {
    this.origin = origin;
    this.state = { tab: 4, mode: 'brief', showStopped: false, selected: {}, rows: [], cursor: -1 };
    this.linear = { status: 'loading', message: 'Loading Linear issues…', open: [], done: [] };
    this.pending = new Map();
    this.bases = new Map();
    this.programStatus = new Map();
    this.dirty = true;
    this.data = this.snapshot();
    this.hidden = new Set(readPreferences().hidden);
    if (this.inboxCount()) this.state.tab = 0;
  }

  inboxCount() {
    return withoutHidden(buildView(0, this.view()), this.hidden).filter((row) => row.kind === 'item').length;
  }

  toggleHidden(item) {
    const hiding = !this.hidden.has(item.key);
    if (hiding) this.hidden.add(item.key); else this.hidden.delete(item.key);
    writePreferences({ ...readPreferences(), hidden: [...this.hidden] });
    this.status('dim', hiding ? `Hid ${item.id}. Press H to see hidden rows.` : `${item.id} is visible again.`);
  }

  view() {
    return { ...this.data, coordinator: this.coordinatorState(), tasks: this.data.tasks.map((task) => applyProgramStatus(task, this.programStatus.get(task.id))), linear: this.linear };
  }

  coordinatorState() {
    const records = this.programStatus.get('coordinator') ?? [];
    const own = records.find((record) => record.id === 'rex-task');
    const root = records.find((record) => !record.id);
    const dialog = own?.state === 'blocked' ? (root?.state === 'blocked' && root.msg ? root.msg : own.msg ?? 'Waiting for you') : undefined;
    return { ask: own?.state === 'working' ? undefined : this.coordinatorAsk, dialog };
  }

  answerCoordinator() {
    this.ask('Answer the coordinator', (message) => (message ? this.request('message', { message }, 'Sent your answer to the coordinator.') : this.status('dim', 'Nothing sent.')), '', { multiline: true });
  }

  focusSurface(surface, label) {
    if (!surface) return this.status('yellow', `Could not find ${label}'s tab.`);
    const window = new RexSurfaceProvider().windowOf(surface);
    if (!window) return this.status('yellow', `${label}'s tab is closed.`);
    callRex(['do', 'session.select', '--args', JSON.stringify({ session_id: surfaceTarget(surface).session, window_id: window })]);
    this.status('green', `Opened ${label}; answer it there.`);
  }

  async pollStatus() {
    if (this.polling) return;
    this.polling = true;
    try {
      const watched = this.data.tasks.filter((task) => !task.stopConfirmed && task.state !== 'stopped');
      if (!this.coordinatorSurface || Date.now() - (this.coordinatorFound ?? 0) > 60_000) {
        this.coordinatorSurface = findCoordinatorSurface(this.origin) ?? this.coordinatorSurface;
        this.coordinatorFound = Date.now();
      }
      const [coordinator, ...results] = await Promise.all([readProgramStatus(this.coordinatorSurface), ...watched.map((task) => readProgramStatus(task.surface))]);
      const next = new Map(watched.flatMap((task, index) => (results[index] ? [[task.id, results[index]]] : [])));
      if (coordinator) next.set('coordinator', coordinator);
      const ask = readCoordinatorAsk(this.origin);
      const changed = JSON.stringify([...next]) !== JSON.stringify([...this.programStatus]) || JSON.stringify(ask) !== JSON.stringify(this.coordinatorAsk);
      this.coordinatorAsk = ask;
      this.programStatus = next;
      if (changed) this.draw();
    } finally {
      this.polling = false;
    }
  }

  snapshot() {
    try {
      return {
        tasks: new TaskStore().list().filter((task) => task.originCwd === this.origin),
        prs: new PullRequestStore().list(this.origin),
        records: new RexWorktrees(null).records(),
        archive: readArchive(),
      };
    } catch (error) {
      this.state.status = { tone: 'red', text: `Task registry unreadable: ${cleanText(error.message)}` };
      return { tasks: [], prs: [], records: [], archive: [] };
    }
  }

  async refreshLinear() {
    this.linear = await loadLinear({ token: this.linear.token });
    this.nameTabs();
    this.draw();
  }

  nameTabs() {
    const preferences = readPreferences();
    const named = preferences.tabNames ?? {};
    const pending = tabsToName(this.data.tasks, [...this.linear.open, ...this.linear.done], named);
    if (!pending.length) return;
    const provider = new RexSurfaceProvider();
    for (const { task, label } of pending) {
      try {
        const window = provider.windowOf(task.surface);
        if (window) callRex(['window', 'rename', '-s', surfaceTarget(task.surface).session, window, label]);
        named[task.id] = window ? label : false;
      } catch {}
    }
    writePreferences({ ...readPreferences(), tabNames: named });
  }

  layout() {
    const data = this.view();
    const { state } = this;
    state.rows = state.hiddenView
      ? hiddenView(data, this.hidden, { search: state.search })
      : withoutHidden(buildView(state.tab, data, { mode: state.tab === 4 ? state.mode : 'brief', showStopped: state.showStopped, search: state.search, filter: state.archiveFilter }), this.hidden);
    const found = state.rows.findIndex((row) => row.kind === 'item' && row.key === state.selected[this.slot()]);
    state.cursor = found === -1 ? moveCursor(state.rows, -1, 0) : found;
    this.remember();
    state.doneCount = brief(data).done.length;
    state.inboxCount = this.inboxCount();
    const count = (tab) => withoutHidden(buildView(tab, data, { showStopped: false }), this.hidden).filter((row) => row.kind === 'item').length;
    state.counts = [state.inboxCount, count(1), count(2), data.tasks.filter(live).length, state.doneCount, data.archive.length, state.search?.issues?.length];
    state.working = data.tasks.filter((task) => live(task) && task.state === 'working').length;
    state.capacity = capacityOf(this.data.tasks, this.origin, [], readMaxAgents());
    state.slots = slotsOf(data.tasks, this.hidden);
    state.records = this.data.records;
    state.now = Date.now();
  }

  slot() { return this.state.hiddenView ? 'hidden' : this.state.tab; }

  remember() {
    const row = this.state.rows[this.state.cursor];
    if (row?.kind === 'item') this.state.selected[this.slot()] = row.key;
  }

  draw() {
    this.dirty = true;
    this.tui?.requestRender();
  }

  status(tone, text) { this.state.status = text ? { tone, text } : undefined; this.draw(); }

  start() {
    this.terminal = new ProcessTerminal();
    this.tui = new TuiAltScreen(this.terminal, false);
    this.root = {
      capturesViewportInput: true,
      render: (width) => {
        if (this.dirty) { this.layout(); this.dirty = false; }
        return renderScreen(this.state, width, this.terminal.rows);
      },
      handleInput: (data) => this.key(keyName(data)),
      invalidate() {},
    };
    this.tui.addChild(this.root);
    this.tui.setFocus(this.root);
    this.tui.addInputListener((data) => {
      if (!this.state.prompt || !(matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c'))) return undefined;
      this.closePrompt('Cancelled.');
      return { consume: true };
    });
    this.tui.start();
    const refresh = () => { if (this.timer) return; this.timer = setTimeout(() => { this.timer = undefined; this.data = this.snapshot(); this.nameTabs(); this.draw(); }, 150); };
    this.watchers = [new TaskStore().root, new PullRequestStore().root].map((root) => {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const watcher = watch(root, refresh);
      watcher.on('error', () => watcher.close());
      return watcher;
    });
    this.poll = setInterval(() => this.checkRequests(), 500);
    this.statusTimer = setInterval(() => { void this.pollStatus(); }, 3_000);
    this.frame = 0;
    this.spinTimer = setInterval(() => {
      if (!this.state.working) return;
      this.frame = (this.frame + 1) % SPINNER.length;
      this.state.spinner = SPINNER[this.frame];
      this.tui?.requestRender();
    }, 80);
    void this.pollStatus();
    this.reload = setInterval(() => { void this.refreshLinear(); }, 5 * 60_000);
    for (const signal of ['SIGTERM', 'SIGHUP']) process.once(signal, () => { this.stop(); process.exit(0); });
    const missed = orphanResults();
    if (missed.length) this.state.status = { tone: missed.every((result) => result.ok) ? 'green' : 'yellow', text: `While the command center was closed: ${summarizeMissed(missed)}` };
    this.draw();
    void this.refreshLinear();
  }

  stop() {
    for (const watcher of this.watchers ?? []) watcher.close();
    clearInterval(this.poll);
    clearInterval(this.statusTimer);
    clearInterval(this.spinTimer);
    clearInterval(this.reload);
    clearTimeout(this.timer);
    this.tui?.stop({ preserveScreen: true });
  }

  key(name) {
    try {
      if (this.state.help) { this.state.help = false; return this.draw(); }
      if (this.state.confirm) return this.confirmKey(name);
      this.listKey(name);
    } catch (error) {
      this.status('red', cleanText(error.message));
    }
  }

  ask(label, submit, value = '', { multiline = false, verb } = {}) {
    const component = multiline ? new Editor(this.tui, editorTheme, { paddingX: 1 }) : new Input({ prompt: `${label} › ` });
    if (multiline) component.setText(value); else component.setValue(value);
    component.onSubmit = (text) => {
      this.closePrompt();
      submit(String(text).trim());
    };
    this.state.prompt = { label, kind: multiline ? 'editor' : 'input', component, verb };
    this.state.status = undefined;
    this.tui?.setFocus(component);
    this.draw();
  }

  closePrompt(message) {
    this.state.prompt = undefined;
    this.tui?.setFocus(this.root);
    if (message) this.status('dim', message); else this.draw();
  }

  confirmKey(name) {
    const confirm = this.state.confirm;
    if (name === 'escape' || name === 'ctrl-c' || name === 'q') { this.state.confirm = undefined; return this.status('dim', 'Cancelled.'); }
    if (confirm.kind === 'cleanup') {
      if (name !== 'enter' && name !== 'p') return;
      this.state.confirm = undefined;
      const preserve = name === 'p';
      if (confirm.items.length > 1 || this.batch) this.batch = this.batch ? { ...this.batch, total: this.batch.total + confirm.items.length } : { total: confirm.items.length, done: 0, failed: [] };
      for (const item of confirm.items) {
        this.request('cleanup', { id: item.task?.logicalId ?? item.task?.id ?? item.pr?.taskId, checkout: checkoutOf(item), preserve },
          this.batch ? `Cleaning up: ${this.batch.done} of ${this.batch.total} done…` : `Cleaning up ${item.task?.name ?? item.id}…`, { batch: Boolean(this.batch), label: item.task?.name ?? item.id, checkout: checkoutOf(item) });
      }
      return;
    }
    if (confirm.kind === 'retire') {
      if (name !== 'enter') return;
      this.state.confirm = undefined;
      return this.request('stop', { id: confirm.task.logicalId ?? confirm.task.id }, `Asked the coordinator to stop ${confirm.task.name}…`);
    }
    if (name === 'tab' && confirm.choices.length > 1) { confirm.index = (confirm.index + 1) % confirm.choices.length; return this.prepare(); }
    if (name === 'N') return this.ask('new project name, created under ~/dev', (project) => this.newProject(confirm, project), confirm.subject.name ?? slugFor(confirm.subject.title ?? confirm.label), { verb: 'create' });
    if (name === 't') return this.ask('repository path', (path) => this.typedRepository(confirm, path), join(homedir(), 'dev', ''));
    if (name === 'e') return this.ask(`Brief for ${confirm.label}`, (text) => { if (text) confirm.brief = text; this.draw(); }, confirm.brief, { multiline: true, verb: 'save' });
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
    if (name === '?') { state.help = true; return this.draw(); }
    if (name === 'escape' && state.hiddenView) { state.hiddenView = false; return this.draw(); }
    if (name === 'escape') return this.status('dim', 'Press q to quit.');
    if (name === 'q' || name === 'ctrl-c') { this.stop(); process.exit(0); }
    if (['up', 'down', 'k', 'j', 'page-up', 'page-down'].includes(name)) {
      state.cursor = moveCursor(state.rows, state.cursor, { up: -1, k: -1, down: 1, j: 1, 'page-up': -10, 'page-down': 10 }[name]);
      this.remember();
      return this.draw();
    }
    if ((/^[1-7]$/.test(name) && Number(name) <= count) || name === 'tab' || name === 'shift-tab') {
      state.tab = /^[1-7]$/.test(name) ? Number(name) - 1 : (state.tab + (name === 'tab' ? 1 : count - 1)) % count;
      state.hiddenView = false;
      state.status = undefined;
      return this.draw();
    }
    if ((name === 'left' || name === 'right') && state.tab === 4) { state.mode = state.mode === 'brief' ? 'list' : 'brief'; return this.draw(); }
    if (name === 'x') { state.showStopped = !state.showStopped; return this.draw(); }
    if (name === 'H') { state.hiddenView = !state.hiddenView; state.status = undefined; return this.draw(); }
    if (name === 'r') {
      this.data = this.snapshot();
      this.status('dim', 'Refreshing…');
      return void this.refreshLinear().then(() => this.status(this.linear.status === 'ok' ? 'dim' : 'yellow', this.linear.status === 'ok' ? `Refreshed ${new Date().toLocaleTimeString()}.` : this.linear.message.split('\n')[0]));
    }
    const item = state.rows[state.cursor]?.kind === 'item' ? state.rows[state.cursor] : undefined;
    if (name === 'n') return this.ask('new task, what should it do?', (goal) => this.newTask(goal));
    if (name === '/' && state.tab === TABS.length - 1) return this.ask('filter the archive', (text) => { state.archiveFilter = text; state.selected[state.tab] = undefined; this.draw(); }, state.archiveFilter ?? '', { verb: 'filter' });
    if (name === '/') return this.ask('search Linear or paste an issue link', (text) => this.search(text));
    if (name === 'c') {
      const cleanup = item?.pr?.state === 'MERGED' && item.pr.cleanup === 'pending' ? `Clean up ${item.task?.name ?? 'the task'} now that ${item.pr.url} is merged.` : '';
      return this.ask('Message the coordinator', (message) => (message ? this.request('message', { message }, 'Sending to the coordinator…') : this.status('dim', 'Nothing sent.')), cleanup, { multiline: true });
    }
    if (!item) return;
    if (item.coordinator && name === 'enter') return item.coordinator.dialog ? this.focusSurface(this.coordinatorSurface, 'the coordinator') : this.answerCoordinator();
    if (item.coordinator && name === 'y' && item.coordinator.ask) return this.request('message', { message: 'Yes.' }, 'Answered the coordinator: yes.');
    if (item.approval && name === 'enter') return this.cleanup([item]);
    if (item.approval && name === 'K') return this.request('retain', { url: item.pr.url }, `Keeping ${item.task?.name ?? item.id}…`);
    if (item.archive && name === 'enter') return this.recall(item);
    if (item.archive && name === 'v') return this.viewTranscript(item);
    if (item.archive && name === 'o') return this.open(item.archive.pullRequests?.[0], item.id);
    if (name === 'enter') return this.enter(item);
    if (name === 'o') return this.open(item.pr?.url ?? item.issue?.url, item.id);
    if (name === 'l') return item.issue ? this.open(item.issue.url, item.id) : this.status('yellow', `${item.id} has no linked Linear issue.`);
    if (name === 's') return this.send(item);
    if (name === 'd') return this.retire(item);
    if (name === 'h') return this.toggleHidden(item);
    if (name === 'D') return this.cleanup([item]);
    if (name === 'a') {
      if (!(item.pr?.state === 'MERGED' && item.pr.cleanup === 'pending')) return this.status('yellow', 'Select a merged PR in the Inbox to clean up all merged tasks.');
      return this.cleanup(inbox(this.view()).merged.filter((entry) => !this.hidden.has(entry.key) && checkoutOf(entry)));
    }
    if (name === 'u') return this.resume(item);
    if (name === 'z') return this.stash(item);
  }

  enter(item) {
    if (stashed(item.task)) return this.resume(item);
    if (live(item.task)) return this.focus(item.task);
    if (item.pr) return this.open(item.pr.url, item.id);
    if (item.issue && !['completed', 'canceled'].includes(item.issue.state.type)) return this.startLaunch(item.issue);
    if (item.issue) return this.open(item.issue.url, item.id);
    this.status('yellow', `${item.id} is stopped. Press u to resume it.`);
  }

  recall(item) {
    const { archive } = item;
    const file = archive.taskLog?.archived;
    if (!file || !existsSync(file)) return this.status('red', `The archived conversation for ${item.id} is missing.`);
    const repo = String(archive.repository ?? '');
    const cwd = repo && existsSync(repo) ? repo : homedir();
    const binding = join(homedir(), '.rex', 'repositories', `${createHash('sha256').update(repo).digest('hex')}.json`);
    const saved = existsSync(binding) ? JSON.parse(readFileSync(binding, 'utf8')).session : undefined;
    const session = JSON.parse(callRex(['ls', '--json'])).sessions.find((entry) => entry.session_id === saved)?.session_id;
    const label = `recall ${item.id}`;
    const command = [join(homedir(), '.pi/agent/bin/pi'), '--fork', file];
    const created = session
      ? JSON.parse(callRex(['window', 'new', '-s', session, label, '-c', cwd, '--json', '--shell=none', '--', ...command]))
      : JSON.parse(callRex(['new', basename(repo) || 'recall', '-c', cwd, '--window', label, '--json', '--shell=none', '--', ...command]));
    const target = session ?? created.session_id;
    const window = created.window_id ?? created.initial_windows?.[0]?.window_id;
    callRex(['do', 'session.select', '--args', JSON.stringify({ session_id: target, window_id: window })]);
    this.status('green', `Reopened ${item.id}'s conversation as a new Pi session in ${basename(cwd)}. The archive is unchanged.`);
  }

  viewTranscript(item) {
    const file = item.archive.taskLog?.archived;
    if (!file || !existsSync(file)) return this.status('red', `The archived conversation for ${item.id} is missing.`);
    const out = join(homedir(), '.rex', 'history-views', `${item.archive.id}.html`);
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    this.status('dim', `Exporting ${item.id}'s transcript…`);
    execFile(join(homedir(), '.pi/agent/bin/pi'), ['--export', file, out], { timeout: 60_000 }, (error) => {
      if (error) return this.status('red', `Could not export the transcript: ${cleanText(error.message).slice(0, 120)}`);
      execFile('open', [out], () => {});
      this.status('green', `Opened ${item.id}'s transcript in your browser.`);
    });
  }

  focus(task) {
    const window = new RexSurfaceProvider().windowOf(task.surface);
    if (!window) return this.status('yellow', `${task.name}'s tab is closed. Press u to resume it in a new tab.`);
    callRex(['do', 'session.select', '--args', JSON.stringify({ session_id: surfaceTarget(task.surface).session, window_id: window })]);
    this.status('green', task.state === 'blocked' ? `Opened ${task.name}; answer it there.` : `Focused ${task.name}.`);
  }

  open(url, label) {
    if (!/^https:\/\/\S+$/.test(url ?? '')) return this.status('yellow', `${label} has no link to open.`);
    execFile('open', [url], (error) => { if (error) this.status('red', `Could not open ${url}`); });
    this.status('green', `Opened ${url}`);
  }

  send(item) {
    if (!live(item.task)) return this.status('yellow', item.task ? `${item.task.name} is stopped; nothing to send to.` : `${item.id} has no running agent. Press enter to launch one.`);
    const { task } = item;
    this.ask(`Message ${task.name}`, (message) => (message
      ? this.request('send', { id: task.logicalId ?? task.id, message }, `Sending to ${task.name}…`)
      : this.status('dim', 'Nothing sent.')), '', { multiline: true });
  }

  resume(item) {
    if (!item.task) return this.status('yellow', `${item.id} has no agent to resume.`);
    if (item.task.stashed && !item.task.stopConfirmed) return this.status('yellow', `${item.task.name} is still being stashed. Resume it once its agent has exited.`);
    if (item.task.stopConfirmed && !item.task.stashed) return this.status('yellow', `${item.task.name} was retired and its tab closed. Launch a new task instead.`);
    if (live(item.task) && item.task.state !== 'unknown') return this.status('yellow', `${item.task.name} is ${item.task.state}. Use s to send it a message.`);
    this.request('resume', { id: item.task.logicalId ?? item.task.id }, `Asked the coordinator to resume ${item.task.name}…`);
  }

  cleaning() {
    return new Set([...this.pending.values()].flatMap((entry) => (entry.checkout ? [entry.checkout] : [])));
  }

  cleanup(items) {
    const busy = this.cleaning();
    const seen = new Set();
    const usable = items.filter((item) => {
      const checkout = checkoutOf(item);
      if (!checkout || !(item.task?.id ?? item.pr?.taskId) || busy.has(checkout) || seen.has(checkout)) return false;
      seen.add(checkout);
      return true;
    });
    if (!usable.length && items.some((item) => busy.has(checkoutOf(item)))) return this.status('yellow', this.batch ? `Already cleaning up: ${this.batch.done} of ${this.batch.total} done.` : 'Already cleaning that up.');
    if (!usable.length) return this.status('yellow', `${items[0]?.id ?? 'This row'} has no checkout to clean up.`);
    this.state.confirm = { kind: 'cleanup', items: usable };
    this.state.status = undefined;
    this.draw();
  }

  stash(item) {
    if (!item.task) return this.status('yellow', `${item.id} has no agent to stash.`);
    if (item.task.stashed) return this.status('dim', `${item.task.name} is already ${item.task.stopConfirmed ? 'stashed. Press u to resume it' : 'being stashed'}.`);
    if (!live(item.task) || ['unknown', 'error'].includes(item.task.state)) return this.status('yellow', `${item.task.name} is not running. Only a running or idle agent can be stashed.`);
    this.request('stash', { id: item.task.logicalId ?? item.task.id }, `Asked the coordinator to stash ${item.task.name}…`);
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
    this.state.tab = SEARCH_TAB;
    this.draw();
    try {
      const issues = await findIssues(this.linear.token, text);
      this.state.search = { query: issueReference(text) ?? text, issues };
      this.state.selected[SEARCH_TAB] = undefined;
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

  newProject(confirm, project) {
    const name = slugFor(project ?? '');
    if (!project) return this.status('dim', 'No project created.');
    let path;
    try { path = createProject(name); } catch (error) { return this.status('red', cleanText(error.message)); }
    confirm.choices.unshift({ path, name, reasons: ['new project you just created'] });
    confirm.index = 0;
    confirm.sure = true;
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
    confirm.direct = directCheckout(choice.path);
    if (confirm.direct) {
      confirm.base = 'HEAD';
      return this.status('dim', '');
    }
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

  request(action, params, message, meta = {}) {
    const id = submitRequest({ origin: this.origin, action, params });
    this.pending.set(id, { at: Date.now(), warned: false, ...meta });
    this.status('dim', message);
  }

  checkRequests() {
    for (const [id, entry] of this.pending) {
      const result = requestState(id, requestRoot());
      if (result.state === 'done' && entry.batch && this.batch) {
        this.pending.delete(id);
        this.data = this.snapshot();
        this.batch.done += 1;
        if (result.outcome === 'duplicate') this.batch.skipped = (this.batch.skipped ?? 0) + 1;
        else if (!result.ok) this.batch.failed.push(`${entry.label} (${explain(result).slice(0, 80)})`);
        const { total, done, failed, skipped = 0 } = this.batch;
        if (done < total) this.status('dim', `Cleaning up: ${done} of ${total} done${failed.length ? `, ${failed.length} need attention` : ''}…`);
        else {
          this.batch = undefined;
          this.status(failed.length ? 'yellow' : 'green', batchSummary({ total, failed, skipped }));
        }
      } else if (result.state === 'done') {
        this.pending.delete(id);
        this.data = this.snapshot();
        this.status(result.ok ? (result.outcome === 'queued' ? 'yellow' : 'green') : 'red', explain(result));
      } else if (result.state === 'queued' && Date.now() - entry.at > REQUEST_TTL) {
        this.pending.delete(id);
        if (entry.batch && this.batch) this.batch = undefined;
        this.status('red', 'The coordinator never picked that up, so nothing was done. Run pinned or /reload it, then try again.');
      } else if (result.state === 'queued' && !entry.warned && Date.now() - entry.at > 10_000) {
        entry.warned = true;
        this.status('yellow', `The coordinator hasn't picked this up. Run pinned, or /reload it. The request expires ${REQUEST_TTL / 1000}s after sending.`);
      }
    }
  }
}

export const tabLabel = (issue) => fit(`${issue.identifier} ${issue.title}`, 40).trimEnd();

export function tabsToName(tasks, issues, named) {
  return tasks.filter((task) => live(task) && !(task.id in named)).flatMap((task) => {
    const issue = issues.find((entry) => linkedTask(entry, [task]));
    return issue ? [{ task, label: tabLabel(issue) }] : [];
  });
}

export function summarizeMissed(results) {
  const counts = new Map();
  for (const result of results) {
    const text = cleanText(result.text).split('. ')[0];
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => (count > 1 ? `${text} (×${count})` : text)).join(' · ');
}

export function slotsOf(tasks, hidden = new Set()) {
  const held = tasks.filter((task) => task.persistent && !task.stopConfirmed);
  return {
    working: held.filter((task) => ['working', 'blocked', 'stopping'].includes(task.state)).length,
    idle: held.filter((task) => ['done', 'idle'].includes(task.state)).length,
    dead: held.filter((task) => ['unknown', 'error'].includes(task.state)).length,
    hidden: held.filter((task) => hidden.has(`t:${task.id}`)).length,
  };
}

export function slotSummary(slots = {}) {
  return [
    `${slots.working ?? 0} working`,
    `${slots.idle ?? 0} idle`,
    slots.dead ? `${slots.dead} not running, d retires` : '',
    slots.hidden ? `${slots.hidden} hidden, H shows` : '',
  ].filter(Boolean).join(' · ');
}

export function batchSummary({ total, failed, skipped = 0 }) {
  const cleaned = total - failed.length - skipped;
  return [
    `Cleaned up ${cleaned} of ${total}.`,
    skipped ? `${skipped} already in progress elsewhere, not counted.` : '',
    failed.length ? `Not cleaned: ${failed.join('; ')}` : '',
  ].filter(Boolean).join(' ');
}

export function explain(result) {
  if (/^Unsupported request action/.test(result.text ?? '')) return 'The coordinator is running older code that cannot do this yet. Run /reload in its tab, then try again.';
  if (/ctx is stale/.test(result.text ?? '')) return 'The coordinator was reloading when this arrived; nothing was done. Try again.';
  return result.text || (result.ok ? 'Done.' : 'Failed.');
}

export function readProgramStatus(surface, run = execFile) {
  let target;
  try { target = surfaceTarget(surface); } catch { return Promise.resolve(undefined); }
  return new Promise((resolve) => {
    run(rexBinary(), ['--autostart=false', 'block', 'call', '-s', target.session, '-b', target.block, 'program_status'], { encoding: 'utf8', timeout: 5_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      try { resolve(JSON.parse(stdout).records ?? []); } catch { resolve(undefined); }
    });
  });
}

export function archiveGoal(file) {
  try {
    const bytes = Buffer.alloc(256 * 1024);
    const descriptor = openSync(file, 'r');
    let text;
    try { text = bytes.subarray(0, readSync(descriptor, bytes, 0, bytes.length, 0)).toString('utf8'); } finally { closeSync(descriptor); }
    for (const row of text.split('\n')) {
      let entry;
      try { entry = JSON.parse(row); } catch { continue; }
      if (entry.message?.role !== 'user') continue;
      const content = entry.message.content;
      const body = typeof content === 'string' ? content : (content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      const goal = body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('<') && !line.startsWith('#') && !/^complete your task\b/i.test(line));
      if (goal) return cleanText(goal.replace(/^(goal|task):\s*/i, '').replace(/^resolve\s+[A-Za-z][A-Za-z0-9]*-\d+:\s*/i, ''));
    }
  } catch {}
  return undefined;
}

export function findCoordinatorSurface(origin) {
  try {
    const sessions = JSON.parse(callRex(['ls', '--json'])).sessions;
    const ordered = [...sessions.filter((session) => ['Command', 'pinned'].includes(session.label)), ...sessions.filter((session) => !['Command', 'pinned'].includes(session.label))];
    for (const session of ordered) {
      const view = JSON.parse(callRex(['session', 'inspect', session.session_id, '--json']));
      for (const block of (view.windows ?? []).flatMap((window) => window.layers.flatMap((layer) => layer.blocks))) {
        if (block.creator_name !== 'com.superlogical.terminal') continue;
        const info = JSON.parse(callRex(['block', 'call', '-s', session.session_id, '-b', block.block_id, 'process']));
        if ([info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === origin)) return `${session.session_id}/${block.block_id}`;
      }
    }
  } catch {}
  return undefined;
}

export function readCoordinatorAsk(origin, root = join(homedir(), '.pi', 'agent', 'sessions')) {
  try {
    const directory = join(root, `--${origin.slice(1).replaceAll('/', '-')}--`);
    const newest = readdirSync(directory).filter((name) => name.endsWith('.jsonl')).map((name) => join(directory, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!newest) return undefined;
    const size = statSync(newest).size;
    const length = Math.min(size, 256 * 1024);
    const bytes = Buffer.alloc(length);
    const descriptor = openSync(newest, 'r');
    try { readSync(descriptor, bytes, 0, length, size - length); } finally { closeSync(descriptor); }
    const entries = bytes.toString('utf8').split('\n').slice(size > length ? 1 : 0).flatMap((row) => { try { return [JSON.parse(row)]; } catch { return []; } });
    return coordinatorAsk(entries);
  } catch {
    return undefined;
  }
}

export function readArchive(history = new TaskHistory()) {
  try {
    return history.list().map((row) => ({ ...row, goal: archiveGoal(row.taskLog?.archived) }));
  } catch {
    return [];
  }
}

const preferencesFile = () => process.env.REX_COMMAND_CENTER_PREFS ?? join(homedir(), '.rex', 'command-center.json');

export function readPreferences(file = preferencesFile()) {
  if (!existsSync(file)) return { hidden: [] };
  const value = JSON.parse(readFileSync(file, 'utf8'));
  return { ...value, hidden: Array.isArray(value.hidden) ? value.hidden.map(String) : [] };
}

export function writePreferences(value, file = preferencesFile()) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

const readMaxAgents = () => loadPersistentConfig(getSubagentsConfigDir(), getSubagentsConfigExamplePath()).maxAgents;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.stdout.isTTY) throw new Error('rex-linear needs an interactive terminal.');
  const app = new LinearApp();
  process.on('uncaughtException', (error) => { app.stop(); console.error(error); process.exit(1); });
  app.start();
}
