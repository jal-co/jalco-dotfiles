import { mkdirSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { moduleConfigFile, readModules } from './module-config.mjs';
import { cleanText, TaskStore } from './tasks.mjs';

export function renderOverview(records, width = 100) {
  const maximum = Math.max(10, width);
  const line = (text) => [...cleanText(text)].slice(0, maximum).join('');
  const rows = [...records].sort((a, b) => {
    const priority = { blocked: 0, error: 1, unknown: 2, working: 3, stopping: 4, done: 5, idle: 6, stopped: 7 };
    return (priority[a.state] ?? 2) - (priority[b.state] ?? 2) || a.name.localeCompare(b.name);
  });
  return [
    'REX TASK OVERVIEW',
    'Read-only. Session names and agents are unchanged. Ctrl+C closes this view.',
    '',
    ...rows.flatMap((record) => [
      line(`${(record.state ?? 'unknown').toUpperCase().padEnd(9)} ${record.name}`),
      line(`  ${record.reason ?? 'No current status evidence'}`),
      line(`  ${record.branch ?? 'No managed branch'} | ${record.model ?? 'model unknown'}`),
      line(`  ${record.surface.split('/')[0]}`),
      '',
    ]),
    ...(rows.length ? [] : ['No tracked tasks yet. Reload the coordinator to enable task recording.']),
  ].join('\n');
}

export function overview() {
  if (!readModules().overview) throw new Error('Rex overview is disabled in modules.json');
  const store = new TaskStore();
  let pending = false;
  const draw = () => {
    pending = false;
    try {
      const text = renderOverview(store.list(), process.stdout.columns ?? 100);
      process.stdout.write(`${process.stdout.isTTY ? '\u001b[H\u001b[2J' : ''}${text}\n`);
    } catch (error) { console.error(`Task overview cannot read its registry: ${cleanText(error)}`); }
  };
  mkdirSync(store.root, { recursive: true, mode: 0o700 });
  draw();
  const watcher = watch(store.root, (_event, name) => {
    if (!String(name).endsWith('.json') || pending) return;
    pending = true;
    setImmediate(draw);
  });
  watcher.on('error', (error) => { console.error(cleanText(error)); stop(); process.exitCode = 1; });
  const config = moduleConfigFile();
  const configWatcher = watch(dirname(config), (_event, name) => {
    if (String(name) !== basename(config)) return;
    try {
      if (readModules().overview) return;
      process.stdout.write('Task overview disabled. Agents and worktrees are unchanged.\n');
    } catch (error) { console.error(cleanText(error)); }
    stop();
  });
  const stop = () => { watcher.close(); configWatcher.close(); process.stdout.removeListener('resize', draw); };
  configWatcher.on('error', (error) => { console.error(cleanText(error)); stop(); process.exitCode = 1; });
  process.stdout.on('resize', draw);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) overview();
