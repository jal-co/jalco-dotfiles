import assert from 'node:assert/strict';
import { readFileSync, watch } from 'node:fs';
import { Manager } from './manager.mjs';
import { Store, cleanText, readJson, terminalStates } from './store.mjs';
import { capabilities } from './adapters.mjs';
import { serve } from './mcp.mjs';

export function renderTask(request, runtime) {
  return ['REX TASK', '', request.name, `Adapter: ${request.adapter}`, `State: ${runtime?.state ?? 'starting'}`, `Directory: ${request.cwd}`, `Run: ${request.id}`, '', runtime?.finishedAt ? 'Outcome recorded. The status tool verifies process exit.' : 'This panel is read-only. Closing it does not stop the agent.'].map(cleanText).join('\n');
}

export function watchTask(store, id) {
  const request = store.request(id);
  const draw = () => {
    const runtime = readJson(store.file(id, 'runtime'));
    process.stdout.write(`${process.stdout.isTTY ? '\x1b[H\x1b[2J' : ''}${renderTask(request, runtime)}\n`);
    if (terminalStates.has(runtime?.state)) stop();
  };
  const watcher = watch(store.directory(id), (_event, name) => {
    if (String(name) !== 'runtime.json') return;
    try { draw(); } catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
  });
  const stop = () => {
    watcher.close();
    process.stdout.removeListener('resize', draw);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  };
  watcher.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
  process.stdout.on('resize', draw);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  draw();
}

export async function main(args) {
  const [action, ...rest] = args;
  const rootAt = rest.indexOf('--root');
  let root;
  if (rootAt >= 0) { root = rest[rootAt + 1]; assert.ok(root, '--root needs a directory'); rest.splice(rootAt, 2); }
  if (!action || action === 'help') {
    console.log('Rex plugins\n\nnode src/cli.mjs launch <spec.json> [--root /state]\nnode src/cli.mjs list|adapters [--root /state]\nnode src/cli.mjs show|stop|capture|watch <run-id> [--root /state]\nnode src/cli.mjs mcp [--root /state]\n\nNo config is installed. Nothing is removed automatically.');
    return;
  }
  const manager = new Manager({ store: new Store(root) });
  if (action === 'mcp') return serve(manager);
  if (action === 'watch') return watchTask(manager.store, rest[0]);
  let result;
  if (action === 'launch') { assert.equal(rest.length, 1, 'launch requires a JSON spec file'); result = manager.launch(JSON.parse(readFileSync(rest[0], 'utf8'))); }
  else if (action === 'list') result = manager.list();
  else if (action === 'adapters') result = capabilities;
  else if (['show', 'stop', 'capture'].includes(action)) { assert.equal(rest.length, 1, 'Expected one exact run ID'); result = manager[action === 'show' ? 'status' : action](rest[0]); }
  else throw new Error(`Unknown command: ${action}`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
