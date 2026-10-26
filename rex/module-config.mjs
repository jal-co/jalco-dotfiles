import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const moduleConfigFile = () => process.env.REX_MODULES_CONFIG ?? fileURLToPath(new URL('./modules.json', import.meta.url));

export function readModules() {
  const value = JSON.parse(readFileSync(moduleConfigFile(), 'utf8'));
  assert.deepEqual(Object.keys(value).sort(), ['overview', 'recovery']);
  for (const enabled of Object.values(value)) assert.ok(enabled === true || enabled === false, 'Rex module flags must be booleans');
  return value;
}
