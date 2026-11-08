import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, watch } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { callRex, surfaceTarget } from './provider.mjs';
import { PullRequestStore } from './pull-requests.mjs';
import { cleanText, TaskStore } from './tasks.ts';
import {
  TABS, buildRows, capacityOf, defaultBase, issueBrief, launchParams, linkedTask, loadLinear, moveCursor,
  pullRequestFor, readLinearConfig, renderView, saveRepository, selectable,
} from './linear.mjs';

type Status = { tone: string; text: string };
type ViewState = { tab: number; selected: string[]; showStopped: boolean; status?: Status };
type ToolParams = ReturnType<typeof launchParams> | { id: string; message: string };
type Tool = { execute: (id: string, params: ToolParams, signal: AbortSignal, onUpdate: () => void, ctx: ExtensionCommandContext) => Promise<{ content: { type: string; text?: string }[]; details?: { error?: string; outcome?: string } }> };
type Options = {
  tools: Map<string, Tool>;
  records: () => { path: string; repo: string }[];
  windowOf: (surface: string) => string | undefined;
  running: () => { id: string; persistent?: boolean }[];
  maxAgents: () => number;
};

const live = (task) => task && !task.stopConfirmed && task.state !== 'stopped';
const rowKey = (row) => (row.kind === 'task' ? `t:${row.item.id}` : `i:${row.item.identifier}`);

export function registerLinearView(pi: ExtensionAPI, { tools, records, windowOf, running, maxAgents }: Options) {
  pi.registerCommand('rex-linear', {
    description: 'Open the Linear command center: assigned issues, backlog, Rex task sessions and today\'s brief',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') { ctx.ui.notify('/rex-linear needs the interactive terminal.', 'error'); return; }
      const view: ViewState = { tab: 2, selected: ['', '', '', ''], showStopped: false };
      let linear: Awaited<ReturnType<typeof loadLinear>> = { status: 'loading', message: 'Loading Linear issues…', open: [], done: [] };
      let token: string | undefined;
      const refreshLinear = () => (async () => {
        try { linear = await loadLinear({ config: readLinearConfig(), token }); } catch (error) {
          linear = { status: 'error', message: `Linear unavailable: ${cleanText(error.message)}`, open: [], done: [] };
        }
        token = linear.token;
      })();
      let pending = refreshLinear();
      const snapshot = () => {
        try {
          const tasks = new TaskStore().list().filter((task) => task.originCwd === ctx.cwd);
          return { tasks, prs: new PullRequestStore().list(ctx.cwd), records: records(), error: undefined };
        } catch (error) {
          return { tasks: [], prs: [], records: [], error: `Task registry unreadable: ${cleanText(error.message)}` };
        }
      };
      const execute = async (name: string, params: ToolParams) => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`${name} is not registered in this coordinator.`);
        const result = await tool.execute(randomUUID(), params, new AbortController().signal, () => {}, ctx);
        const text = cleanText(result.content.map((part) => part.text ?? '').join(' '));
        return { tone: result.details?.error ? 'error' : result.details?.outcome === 'queued' ? 'warning' : 'success', text };
      };
      const focus = (task): Status => {
        const window = windowOf(task.surface);
        if (!window) return { tone: 'warning', text: `${task.name}'s tab is closed. Resume or retire it from the coordinator.` };
        callRex(['do', 'session.select', '--args', JSON.stringify({ session_id: surfaceTarget(task.surface).session, window_id: window })]);
        return { tone: 'success', text: `Focused ${task.name}.` };
      };
      const open = (url: string, label: string): Status => {
        if (!/^https:\/\/[^\s]+$/.test(url)) return { tone: 'error', text: `Refusing to open a non-HTTPS URL for ${label}.` };
        execFile('open', [url], () => {});
        return { tone: 'success', text: `Opened ${url}` };
      };

      while (true) {
        const action = await ctx.ui.custom<{ type: 'send' | 'launch'; item } | undefined>((tui, theme, _keybindings, done) => {
          let data = snapshot();
          let closed = false;
          let queued = false;
          let rows = [];
          let cursor = -1;
          const layout = () => {
            rows = buildRows(view.tab, { ...data, linear }, { showStopped: view.showStopped });
            const found = rows.findIndex((row) => selectable(row) && rowKey(row) === view.selected[view.tab]);
            cursor = found === -1 ? moveCursor(rows, -1, 0) : found;
            if (cursor !== -1) view.selected[view.tab] = rowKey(rows[cursor]);
          };
          const rerender = () => { if (!closed) { layout(); tui.requestRender(); } };
          const finish = (result) => { closed = true; watcher?.close(); done(result); };
          mkdirSync(new TaskStore().root, { recursive: true, mode: 0o700 });
          const watcher = watch(new TaskStore().root, (_event, name) => {
            if (!String(name).endsWith('.json') || queued) return;
            queued = true;
            setTimeout(() => { queued = false; data = snapshot(); rerender(); }, 150);
          });
          watcher.on('error', () => watcher.close());
          pending.then(rerender);
          layout();
          const status = (next: Status) => { view.status = next; rerender(); };
          const counts = () => [
            linear.open.filter((issue) => ['started', 'unstarted'].includes(issue.state.type)).length,
            linear.open.filter((issue) => ['backlog', 'triage'].includes(issue.state.type)).length,
            data.tasks.filter(live).length,
            undefined,
          ];
          return {
            render(width: number) {
              const height = Math.max(12, (process.stdout.rows ?? 30) - 4);
              const capacity = capacityOf(data.tasks, ctx.cwd, running(), maxAgents());
              const message = data.error ? { tone: 'error', text: data.error } : view.status;
              return renderView({ tab: view.tab, rows, cursor, status: message, capacity, counts: counts() }, width, height).map((line) => {
                const text = truncateToWidth(line.text, width, '…', line.selected);
                const styled = line.tone === 'title' ? theme.bold(theme.fg('accent', text)) : theme.fg(line.tone, text);
                return line.selected ? theme.bg('selectedBg', styled) : styled;
              });
            },
            invalidate() {},
            handleInput(input: string) {
              const row = rows[cursor];
              const task = row?.kind === 'task' ? row.item : row?.kind === 'issue' ? linkedTask(row.item, data.tasks) : undefined;
              const tab = Number(input) - 1;
              try {
                if (matchesKey(input, Key.escape) || matchesKey(input, 'q')) return finish(undefined);
                if (matchesKey(input, Key.up) || matchesKey(input, 'k') || matchesKey(input, Key.down) || matchesKey(input, 'j')) {
                  cursor = moveCursor(rows, cursor, matchesKey(input, Key.up) || matchesKey(input, 'k') ? -1 : 1);
                  if (cursor !== -1) view.selected[view.tab] = rowKey(rows[cursor]);
                  return rerender();
                }
                if (matchesKey(input, Key.tab) || matchesKey(input, Key.shift(Key.tab)) || (Number.isInteger(tab) && tab >= 0 && tab < TABS.length)) {
                  view.tab = Number.isInteger(tab) && tab >= 0 ? tab : (view.tab + (matchesKey(input, Key.tab) ? 1 : TABS.length - 1)) % TABS.length;
                  return rerender();
                }
                if (matchesKey(input, 'x')) { view.showStopped = !view.showStopped; return rerender(); }
                if (matchesKey(input, 'r')) {
                  status({ tone: 'muted', text: 'Refreshing…' });
                  pending = refreshLinear();
                  pending.then(() => { data = snapshot(); status({ tone: 'muted', text: linear.status === 'ok' ? `Refreshed ${new Date().toLocaleTimeString()}.` : linear.message.split('\n')[0] }); });
                  return;
                }
                if (!row) return;
                if (matchesKey(input, Key.enter)) {
                  if (live(task)) return status(focus(task));
                  if (row.kind === 'task') return status({ tone: 'warning', text: `${task.name} is stopped. Resume it with subagent_resume from the coordinator.` });
                  return finish({ type: 'launch', item: row.item });
                }
                if (matchesKey(input, 'o')) {
                  const pr = task && pullRequestFor(task, data.prs);
                  if (pr) return status(open(pr.url, task.name));
                  if (row.kind === 'issue') return status(open(row.item.url, row.item.identifier));
                  return status({ tone: 'warning', text: `${task.name} has no tracked PR yet.` });
                }
                if (matchesKey(input, 's')) {
                  if (!live(task)) return status({ tone: 'warning', text: task ? `${task.name} is stopped; nothing to send to.` : 'This issue has no running agent. Press enter to launch one.' });
                  return finish({ type: 'send', item: task });
                }
              } catch (error) {
                status({ tone: 'error', text: cleanText(error.message) });
              }
            },
          };
        });
        if (!action) return;
        try {
          view.status = action.type === 'send' ? await send(action.item) : await launch(action.item);
        } catch (error) {
          view.status = { tone: 'error', text: cleanText(error.message) };
        }
      }

      async function send(task): Promise<Status> {
        const message = await ctx.ui.editor(`Message for ${task.name} (queued if it is mid-turn)`, '');
        if (!message?.trim()) return { tone: 'muted', text: 'Nothing sent.' };
        return execute('subagent_send', { id: task.logicalId ?? task.id, message: message.trim() });
      }

      async function launch(issue): Promise<Status> {
        const capacity = capacityOf(new TaskStore().list(), ctx.cwd, running(), maxAgents());
        if (capacity.used >= capacity.max) return { tone: 'error', text: `Agent cap reached (${capacity.used}/${capacity.max}). Stop or retire a task before launching ${issue.identifier}.` };
        const team = issue.team.key;
        let repo = readLinearConfig().repositories[team];
        if (!repo) {
          repo = (await ctx.ui.input(`Repository checkout for Linear team ${team}`, '/Users/…'))?.trim();
          if (!repo) return { tone: 'muted', text: 'Launch cancelled.' };
          if (!isAbsolute(repo) || !existsSync(join(repo, '.git'))) return { tone: 'error', text: `${repo} is not a Git checkout.` };
          saveRepository(team, repo);
        }
        ctx.ui.notify(`Fetching the default branch for ${repo}…`, 'info');
        const { base, warning } = await defaultBase(repo);
        const params = launchParams(issue, { repo, base, brief: '' });
        const brief = await ctx.ui.editor(`Brief for ${issue.identifier} on ${params.worktree.branch} from ${base}`, issueBrief(issue, params.worktree.branch));
        if (!brief?.trim()) return { tone: 'muted', text: 'Launch cancelled.' };
        const result = await execute('subagent', { ...params, task: brief.trim() });
        return warning ? { ...result, text: `${warning} ${result.text}` } : result;
      }
    },
  });
}
