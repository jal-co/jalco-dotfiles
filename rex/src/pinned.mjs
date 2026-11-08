import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
const terminals = (id) => {
  const view = JSON.parse(callRex(['session', 'inspect', id, '--json']));
  return (view.windows ?? []).flatMap((window) => window.layers.flatMap((layer) => layer.blocks))
    .filter((block) => block.creator_name === 'com.superlogical.terminal')
    .map((block) => ({ ...JSON.parse(callRex(['block', 'call', '-s', id, '-b', block.block_id, 'process'])), block_id: block.block_id, label: block.label }));
};
const addCommandCenter = (session) => {
  const blocks = terminals(session);
  const running = (info) => [info.foreground, info.child, ...(info.ancestors ?? [])].some((process) => process?.script === commandCenter || process?.argv?.includes(commandCenter));
  if (blocks.some((info) => info.label === 'command-center' || running(info))) return false;
  const coordinator = blocks.find((info) => [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd));
  if (!coordinator) throw new Error(`Cannot find the coordinator terminal in ${session}; the command center was not added.`);
  addPane(session, coordinator.block_id);
  return true;
};
const addPane = (session, block) => callRex(['split', '-s', session, '-b', block, '--split', 'above', '--ratio', '50', '--focus=false',
  '--label', 'command-center', '--shell=none', '-c', cwd, '--', join(homedir(), '.local/share/mise/shims/node'), commandCenter]);
const piCommand = () => {
  const config = JSON.parse(readFileSync(join(configDir, 'herdr-agents/config.json'), 'utf8'));
  const model = config.models?.default;
  if (!model) throw new Error('No default agent model configured. Shared model preferences were not changed.');
  const pi = join(homedir(), '.pi/agent/bin/pi');
  if (!existsSync(pi)) throw new Error(`Pi executable not found: ${pi}`);
  return [pi, '--approve', '--model', model];
};
const sessions = JSON.parse(callRex(['ls', '--json'])).sessions;
const existing = findCoordinator(sessions, terminals, cwd);
if (existing?.stopped) {
  const created = JSON.parse(callRex(['window', 'new', '-s', existing.session_id, 'coordinator', '-c', cwd, '--json', '--shell=none', '--', ...piCommand()]));
  addPane(existing.session_id, created.block_ids[0]);
  console.log(`Started the coordinator in a new tab of ${JSON.stringify(existing.label)} (${existing.session_id}) with the command center above it. Its other tabs were left alone.`);
} else if (existing) {
  const added = addCommandCenter(existing.session_id);
  console.log(`Rex coordinator already exists: ${existing.session_id}.${added ? ' Added the command center above it.' : ''} Select ${JSON.stringify(existing.label)} in Rex.`);
} else {
  const created = JSON.parse(callRex(['new', label, '-c', cwd, '--window', 'coordinator', '--json', '--shell=none', '--', ...piCommand()]));
  addPane(created.session_id, created.initial_windows[0].block_ids[0]);
  console.log(`Created ${label}: ${created.session_id} with the command center above the coordinator. Select it in Rex.`);
}
