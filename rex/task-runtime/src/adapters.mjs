import assert from 'node:assert/strict';
import { join } from 'node:path';

export const capabilities = {
  command: { terminal: true, transcript: false, followUp: false, resume: false, completion: 'process-exit', stop: 'sigterm-child' },
  pi: { terminal: false, transcript: true, followUp: false, resume: false, completion: 'process-exit', stop: 'sigterm-child' },
};

export function commandFor(spec, directory) {
  assert.ok(Object.hasOwn(capabilities, spec.adapter), 'Unknown adapter');
  if (spec.adapter === 'command') {
    assert.ok(spec.prompt === undefined && spec.model === undefined && spec.binary === undefined, 'command uses argv, not Pi options');
    assert.ok(Array.isArray(spec.argv) && spec.argv.length > 0 && spec.argv.length <= 256, 'argv must contain 1 to 256 arguments');
    assert.ok(spec.argv.every((part) => typeof part === 'string' && !part.includes('\0') && Buffer.byteLength(part) <= 131072), 'Invalid argument');
    assert.ok(spec.argv[0].length > 0, 'Executable is required');
    return { argv: spec.argv, capture: false };
  }
  assert.ok(spec.argv === undefined, 'pi uses prompt, not argv');
  assert.ok(typeof spec.prompt === 'string' && spec.prompt.trim() && Buffer.byteLength(spec.prompt) <= 65536, 'Pi prompt must contain 1 to 65536 bytes');
  assert.ok(spec.binary === undefined || (typeof spec.binary === 'string' && spec.binary && !spec.binary.includes('\0')), 'Invalid Pi binary');
  assert.ok(spec.model === undefined || (typeof spec.model === 'string' && /^[^\s/]+\/[^\s]+$/.test(spec.model)), 'Use an exact provider/model reference');
  const argv = [spec.binary ?? 'pi', '--print', '--mode', 'json', '--no-extensions', '--no-mcp', '--session', join(directory, 'pi-session.jsonl')];
  if (spec.model) argv.push('--model', spec.model);
  argv.push('--', spec.prompt);
  return { argv, capture: true };
}
