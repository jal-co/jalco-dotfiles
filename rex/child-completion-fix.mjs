import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const original = '\t\t\tif (persistent && sessionFile && currentTask) {\n\t\t\t\tappendPersistentTaskEvent(\n\t\t\t\t\tsessionFile,\n\t\t\t\t\tbuildPersistentTaskEvent(currentTask, generation),\n\t\t\t\t);\n\t\t\t\tcurrentTask = "";';
const fixed = '\t\t\tif (persistent) {\n\t\t\t\tif (!sessionFile) throw new Error("Persistent task has no session file; refusing to shut down.");\n\t\t\t\tif (currentTask) {\n\t\t\t\t\tappendPersistentTaskEvent(\n\t\t\t\t\t\tsessionFile,\n\t\t\t\t\t\tbuildPersistentTaskEvent(currentTask, generation),\n\t\t\t\t\t);\n\t\t\t\t\tcurrentTask = "";\n\t\t\t\t}';

export function patchPersistentCompletion(source) {
  const before = source.split(original).length - 1;
  const after = source.split(fixed).length - 1;
  if (before === 0 && after === 1) return source;
  assert.equal(before, 1, 'Expected the known 3.3.1 persistent completion handler; refusing to modify an unknown source');
  assert.equal(after, 0, 'Ambiguous persistent completion handler');
  return source.replace(original, fixed);
}

export function applyChildCompletionFix(root) {
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '3.3.1', 'Recheck the completion fix before changing host versions');
  const file = join(root, 'maestro/adapters/pi/child/subagent-done.ts');
  const source = readFileSync(file, 'utf8');
  const patched = patchPersistentCompletion(source);
  if (patched === source) return false;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, patched, { mode: statSync(file).mode & 0o777, flag: 'wx' });
    assert.equal(readFileSync(file, 'utf8'), source, 'Child handler changed while preparing the fix');
    renameSync(temporary, file);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'), 'npm/node_modules/pi-herdr-agents');
  console.log(applyChildCompletionFix(root) ? 'Installed persistent completion fix' : 'Persistent completion fix already installed');
}
