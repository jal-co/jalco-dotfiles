import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from './provider.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const stateRoot = join(homedir(), '.local/state');
mkdirSync(stateRoot, { recursive: true });
const root = mkdtempSync(join(stateRoot, 'pi-rex-package-proof-'));
mkdirSync(join(root, '.pi'));
writeFileSync(join(root, '.pi/settings.json'), readFileSync(join(source, 'coordinator/settings.json')));
writeFileSync(join(root, 'modules.json'), '{"recovery":false,"overview":false}');
const guard = join(root, 'proof.ts');
writeFileSync(guard, `export default function(pi) {
  pi.on('before_provider_request', () => { throw new Error('No model requests allowed in package proof'); });
  pi.registerCommand('package-proof-info', { description: 'Read package tool registrations', handler: async () => {
    pi.sendMessage({ customType: 'package-proof-info', content: 'Package registrations', display: false, details: pi.getAllTools().map(tool => tool.name) });
  }});
  pi.registerCommand('package-proof-reload', { description: 'Reload fixture', handler: async (_args, ctx) => { await ctx.reload(); } });
}`);
const session = JSON.parse(callRex(['new', 'pi-rex-package-proof', '-c', root, '--json']));
const events = []; const bus = new EventEmitter(); let buffer = ''; let stderr = '';
const child = spawn(join(homedir(), '.pi/agent/bin/pi'), ['--mode', 'rpc', '--approve', '--no-mcp', '--no-skills', '--no-context-files', '-e', guard], {
  cwd: root, env: { ...process.env, REX_SESSION: session.session_id, REX_TASK_ROOT: join(root, 'tasks'), REX_PR_ROOT: join(root, 'prs'), REX_HISTORY_ROOT: join(root, 'history'), REX_MODULES_CONFIG: join(root, 'modules.json') }, stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString(); let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.startsWith('{')) continue;
    const event = JSON.parse(line); events.push(event); bus.emit('event', event);
  }
});
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
const receive = (predicate) => new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); bus.removeListener('event', listener); };
  const listener = (event) => {
    if (event.type === 'extension_error') { cleanup(); reject(new Error(JSON.stringify(event))); }
    else if (predicate(event)) { cleanup(); resolve(event); }
  };
  const timer = setTimeout(() => { cleanup(); reject(new Error('Package proof timed out')); }, 30000);
  bus.on('event', listener);
});
const send = (request) => child.stdin.write(`${JSON.stringify(request)}\n`);
let passed = false;
try {
  const ready = receive((event) => event.type === 'response' && event.id === 'ready');
  send({ type: 'get_state', id: 'ready' }); assert.equal((await ready).success, true);
  for (const round of [1, 2]) {
    const info = receive((event) => event.type === 'message_end' && event.message?.customType === 'package-proof-info');
    send({ type: 'prompt', message: '/package-proof-info', id: `info-${round}` });
    const names = (await info).message.details;
    for (const name of ['subagent', 'subagent_stop', 'worktree_remove', 'rex_pr_track', 'rex_task_history']) assert.equal(names.filter((value) => value === name).length, 1, name);
    if (round === 1) {
      const reloaded = receive((event) => event.type === 'response' && event.id === 'reload');
      send({ type: 'prompt', message: '/package-proof-reload', id: 'reload' });
      assert.equal((await reloaded).success, true);
    }
  }
  passed = true;
} finally {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.stdin.end(); await exited; }
  callRex(['kill', session.session_id]);
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed, events, stderr }, null, 2));
  console.log(`Native package load/reload proof ${passed ? 'passed' : 'failed'}: ${root}`);
}
