import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from './provider.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
const cwd = join(homedir(), 'rex-coord');
const label = 'pinned';

if (process.argv.length > 2) {
  console.log('Usage: pinned');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const settings = join(cwd, '.pi/settings.json');
const instructions = join(cwd, 'AGENTS.md');
for (const [target, source] of [[settings, join(root, 'coordinator/settings.json')], [instructions, join(root, 'coordinator/AGENTS.md')]]) {
  if (!existsSync(target) || realpathSync(target) !== realpathSync(source)) {
    throw new Error(`Missing dotfiles link ${target}. Run mise dot apply from ~/dotfiles before launching.`);
  }
}
const sessions = JSON.parse(callRex(['ls', '--json'])).sessions;
const existing = sessions.filter((session) => session.label === label);
if (existing.length > 1) throw new Error('Multiple pinned Rex coordinators exist. Select the intended session in Rex.');
if (existing.length) {
  const view = JSON.parse(callRex(['session', 'inspect', existing[0].session_id, '--json']));
  const blocks = view.windows.flatMap((window) => window.layers.flatMap((layer) => layer.blocks));
  const running = blocks.some((block) => {
    const info = JSON.parse(callRex(['block', 'call', '-s', existing[0].session_id, '-b', block.block_id, 'process']));
    return !info.last_exit && info.foreground?.argv0 === 'pi' && info.foreground.cwd === cwd;
  });
  if (!running) throw new Error(`Session ${existing[0].session_id} exists but its coordinator is not running. Inspect it in Rex before closing or restarting it.`);
  console.log(`Rex coordinator already exists: ${existing[0].session_id}. Select ${label} in Rex.`);
} else {
  const config = JSON.parse(readFileSync(join(configDir, 'herdr-agents/config.json'), 'utf8'));
  const model = config.models?.default;
  if (!model) throw new Error('No default agent model configured. Shared model preferences were not changed.');
  const pi = join(homedir(), '.pi/agent/bin/pi');
  if (!existsSync(pi)) throw new Error(`Pi executable not found: ${pi}`);
  const created = JSON.parse(callRex([
    'new', label, '-c', cwd, '--window', 'coordinator', '--json', '--shell=none', '--',
    pi, '--approve', '--model', model,
  ]));
  console.log(`Created ${label}: ${created.session_id}. Select it in Rex.`);
}
