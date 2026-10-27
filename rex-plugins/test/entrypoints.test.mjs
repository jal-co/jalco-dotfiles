import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'rex-entrypoints-test-'));
const linked = join(root, 'linked');
symlinkSync(fileURLToPath(new URL('..', import.meta.url)), linked, 'dir');
const run = (file, args = [], input) => spawnSync(process.execPath, [join(linked, file), ...args], { input, encoding: 'utf8', timeout: 5000, env: { ...process.env, REX_PLUGINS_STATE: join(root, 'state') } });

test('CLI executes through a symlinked checkout', () => {
  const result = run('src/cli.mjs', ['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rex plugins/);
});

test('MCP entrypoint initializes through a symlinked checkout', () => {
  const result = run('src/mcp.mjs', [], JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.serverInfo.name, 'rex-plugins');
});

test('runner validates requests through a symlinked checkout', () => {
  const result = run('src/runner.mjs', ['--root', join(root, 'runner-state'), 'not-a-run-id']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected an exact run UUID/);
});

test('pin entrypoint rejects an invalid action through a symlink without contacting Rex', () => {
  const result = run('plugins/session-pins/session-pins.mjs', ['invalid-action']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown pin action/);
});

test('importing entrypoint modules does not start a CLI or MCP server', () => {
  const files = ['src/cli.mjs', 'src/runner.mjs', 'src/mcp.mjs', 'plugins/session-pins/session-pins.mjs'];
  const script = files.map((file) => `await import(${JSON.stringify(new URL(`../${file}`, import.meta.url).href)});`).join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], { input: script, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
