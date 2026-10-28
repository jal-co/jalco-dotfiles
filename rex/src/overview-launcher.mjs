import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { moduleConfigFile, readModules } from './module-config.mjs';
import { callRex } from './provider.mjs';
import { taskRoot } from './tasks.ts';

export function openOverview(label = 'Task Overview') {
  if (!readModules().overview) throw new Error('Rex overview is disabled in modules.json');
  const script = fileURLToPath(new URL('./overview.mjs', import.meta.url));
  const file = join(dirname(taskRoot()), 'overview-session.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  mkdirSync(lock);
  try {
    const sessions = JSON.parse(callRex(['ls', '--json'])).sessions ?? [];
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).session_id : undefined;
    const matches = sessions.filter((session) => saved && session.session_id === saved);
    if (!matches.length && sessions.some((session) => session.label === label)) throw new Error('An unclaimed overview session already uses this name. Inspect it before creating another.');
    if (matches.length > 1) throw new Error('Multiple Task Overview sessions exist. Select the intended one manually.');
    let found = matches[0];
    if (found) {
      const view = JSON.parse(callRex(['session', 'inspect', found.session_id, '--json']));
      const blocks = view.windows.flatMap((window) => window.layers.flatMap((layer) => layer.blocks)).filter((block) => block.creator_name === 'com.superlogical.terminal');
      if (!blocks.some((block) => {
        const process = JSON.parse(callRex(['block', 'call', '-s', found.session_id, '-b', block.block_id, 'process']));
        return [process.foreground, process.child].some((entry) => entry?.script === script);
      })) throw new Error('The existing overview session is not running this module. Inspect it before opening another.');
    } else {
      found = JSON.parse(callRex(['new', label, '-c', homedir(), '--json', '--shell=none', '--', '/usr/bin/env', `REX_TASK_ROOT=${taskRoot()}`, `REX_MODULES_CONFIG=${moduleConfigFile()}`, join(homedir(), '.local/share/mise/shims/node'), script]));
    }
    writeFileSync(`${file}.tmp`, JSON.stringify({ session_id: found.session_id }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    const actions = JSON.parse(callRex(['actions', '--json'])).actions;
    if (actions.some((action) => action.name === 'pin_session')) callRex(['do', '-s', found.session_id, 'pin_session']);
    return found;
  } finally { rmdirSync(lock); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(openOverview()));
