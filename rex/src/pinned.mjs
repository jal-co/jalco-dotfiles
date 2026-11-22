import { existsSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRex } from './provider.ts';
import { findCoordinator } from './coordinator-session.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
const cwd = join(homedir(), 'rex-coord');
const label = 'Command';

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
  const config = JSON.parse(readFileSync(join(configDir, 'rex-agents/config.json'), 'utf8'));
  const model = config.models?.default;
  if (!model) throw new Error('No default agent model configured. Shared model preferences were not changed.');
  const pi = join(homedir(), '.pi/agent/bin/pi');
  if (!existsSync(pi)) throw new Error(`Pi executable not found: ${pi}`);
  return [pi, '--approve', '--model', model];
};
const idle = (info) => !info.last_exit && (!info.foreground || /^-|(^|\/)(zsh|bash|fish|sh)$/.test(info.foreground.argv0 ?? ''));
const idleWindows = (id, label) => {
  const info = new Map(terminals(id).map((entry) => [entry.block_id, entry]));
  const view = JSON.parse(callRex(['session', 'inspect', id, '--json']));
  return (view.windows ?? []).filter((window) => window.label === label)
    .filter((window) => window.layers.every((layer) => layer.blocks.every((block) => !info.has(block.block_id) || idle(info.get(block.block_id)))));
};
const pin = (session) => {
  const actions = JSON.parse(callRex(['actions', '--json'])).actions;
  if (actions.some((action) => action.name === 'pin_session')) callRex(['do', '-s', session, 'pin_session']);
};

const sessions = JSON.parse(callRex(['ls', '--json'])).sessions;
const existing = findCoordinator(sessions, terminals, cwd);
let session = existing;
if (existing?.stopped) {
  for (const window of idleWindows(existing.session_id, 'coordinator')) {
    callRex(['window', 'close', '-s', existing.session_id, window.window_id]);
    console.log('Closed a coordinator tab left with only a shell, such as one Rex restored after a reboot.');
  }
  callRex(['window', 'new', '-s', existing.session_id, 'coordinator', '-c', cwd, '--json', '--shell=none', '--', ...piCommand()]);
  console.log(`Started the coordinator in a new tab of ${JSON.stringify(existing.label)}. Its other tabs were left alone.`);
} else if (existing) {
  console.log(`Rex coordinator already runs in ${JSON.stringify(existing.label)}.`);
} else {
  const created = JSON.parse(callRex(['new', label, '-c', cwd, '--window', 'coordinator', '--json', '--shell=none', '--', ...piCommand()]));
  session = { session_id: created.session_id, label };
  console.log(`Created ${label} with the coordinator.`);
}
if (session.label === 'pinned') {
  callRex(['session', 'rename', session.session_id, label]);
  console.log(`Renamed the old default "pinned" session to ${JSON.stringify(label)}.`);
}

for (const other of sessions.filter((entry) => entry.session_id !== session.session_id)) {
  for (const block of terminals(other.session_id).filter((info) => info.label === 'command-center')) {
    callRex(['block', 'close', '-s', other.session_id, block.block_id]);
    console.log(`Closed the old command center pane in ${JSON.stringify(other.label)}.`);
  }
}
const legacy = existsSync(centerFile) ? JSON.parse(readFileSync(centerFile, 'utf8')).session_id : undefined;
if (sessions.some((entry) => entry.session_id === legacy && entry.label === centerLabel)) {
  callRex(['kill', legacy]);
  console.log(`Closed the separate ${JSON.stringify(centerLabel)} session; the command center is now a tab of ${JSON.stringify(label)}.`);
}
if (legacy) unlinkSync(centerFile);

const view = JSON.parse(callRex(['session', 'inspect', session.session_id, '--json']));
const installed = existsSync(join(root, 'node_modules/@earendil-works/pi-tui'));
const coordinatorWindow = existing && !existing.stopped && (view.windows ?? []).find((window) => /^Window [0-9a-f]{8}$/.test(window.label ?? '')
  && window.layers.some((layer) => layer.blocks.some((block) => terminals(session.session_id).some((info) => info.block_id === block.block_id
    && [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd)))));
if (coordinatorWindow) callRex(['window', 'rename', '-s', session.session_id, coordinatorWindow.window_id, 'coordinator']);
const staleCenters = idleWindows(session.session_id, centerLabel);
for (const window of staleCenters) {
  callRex(['window', 'close', '-s', session.session_id, window.window_id]);
  console.log(`Closed a ${JSON.stringify(centerLabel)} tab left with only a shell.`);
}
const open = (view.windows ?? []).some((window) => window.label === centerLabel && !staleCenters.some((stale) => stale.window_id === window.window_id)
  && window.layers.some((layer) => layer.blocks.length));
if (open) {
  console.log(`The ${JSON.stringify(centerLabel)} tab is already open.`);
} else if (!installed) {
  console.log(`The command center needs its terminal library. Run npm install --prefix ${root}, then pinned again.`);
} else {
  callRex(['window', 'new', '-s', session.session_id, centerLabel, '-c', cwd, '--focus=false', '--json', '--shell=none', '--',
    join(homedir(), '.local/share/mise/shims/node'), commandCenter]);
  console.log(`Opened the command center in a ${JSON.stringify(centerLabel)} tab.`);
}
pin(session.session_id);
console.log(`Select ${JSON.stringify(label)} in Rex.`);
