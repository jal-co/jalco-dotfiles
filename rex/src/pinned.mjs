import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from './provider.mjs';
import { findCoordinator } from './coordinator-session.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const commandCenter = join(root, 'src/linear-tui.mjs');
const centerLabel = '\u{f0516} linear';
const centerFile = join(homedir(), '.rex', 'command-center-session.json');
const terminals = (id) => {
  const view = JSON.parse(callRex(['session', 'inspect', id, '--json']));
  return (view.windows ?? []).flatMap((window) => window.layers.flatMap((layer) => layer.blocks))
    .filter((block) => block.creator_name === 'com.superlogical.terminal')
    .map((block) => ({ ...JSON.parse(callRex(['block', 'call', '-s', id, '-b', block.block_id, 'process'])), block_id: block.block_id, label: block.label }));
};
const piCommand = () => {
  const config = JSON.parse(readFileSync(join(configDir, 'herdr-agents/config.json'), 'utf8'));
  const model = config.models?.default;
  if (!model) throw new Error('No default agent model configured. Shared model preferences were not changed.');
  const pi = join(homedir(), '.pi/agent/bin/pi');
  if (!existsSync(pi)) throw new Error(`Pi executable not found: ${pi}`);
  return [pi, '--approve', '--model', model];
};
const pin = (session) => {
  const actions = JSON.parse(callRex(['actions', '--json'])).actions;
  if (actions.some((action) => action.name === 'pin_session')) callRex(['do', '-s', session, 'pin_session']);
};

const sessions = JSON.parse(callRex(['ls', '--json'])).sessions;
const existing = findCoordinator(sessions, terminals, cwd);
if (existing?.stopped) {
  callRex(['window', 'new', '-s', existing.session_id, 'coordinator', '-c', cwd, '--json', '--shell=none', '--', ...piCommand()]);
  console.log(`Started the coordinator in a new tab of ${JSON.stringify(existing.label)} (${existing.session_id}). Its other tabs were left alone.`);
} else if (existing) {
  console.log(`Rex coordinator already exists: ${existing.session_id}. Select ${JSON.stringify(existing.label)} in Rex.`);
} else {
  const created = JSON.parse(callRex(['new', label, '-c', cwd, '--window', 'coordinator', '--json', '--shell=none', '--', ...piCommand()]));
  console.log(`Created ${label}: ${created.session_id}. Select it in Rex.`);
}

const saved = existsSync(centerFile) ? JSON.parse(readFileSync(centerFile, 'utf8')).session_id : undefined;
const center = sessions.find((session) => session.session_id === saved) ?? sessions.find((session) => session.label === centerLabel);
for (const session of sessions.filter((entry) => entry.session_id !== center?.session_id)) {
  for (const block of terminals(session.session_id).filter((info) => info.label === 'command-center')) {
    callRex(['block', 'close', '-s', session.session_id, block.block_id]);
    console.log(`Moved the command center out of ${JSON.stringify(session.label)} into its own session.`);
  }
}
const run = [join(homedir(), '.local/share/mise/shims/node'), commandCenter];
if (center && !terminals(center.session_id).length) {
  callRex(['window', 'new', '-s', center.session_id, 'command center', '-c', cwd, '--json', '--shell=none', '--', ...run]);
  console.log(`Reopened the command center in ${JSON.stringify(center.label)} (${center.session_id}).`);
} else if (center) {
  console.log(`Command center already open: ${JSON.stringify(center.label)} (${center.session_id}).`);
} else {
  const created = JSON.parse(callRex(['new', centerLabel, '-c', cwd, '--window', 'command center', '--json', '--shell=none', '--', ...run]));
  mkdirSync(dirname(centerFile), { recursive: true, mode: 0o700 });
  writeFileSync(centerFile, JSON.stringify({ session_id: created.session_id }), { mode: 0o600 });
  pin(created.session_id);
  console.log(`Opened the command center in ${JSON.stringify(centerLabel)} (${created.session_id}).`);
}
