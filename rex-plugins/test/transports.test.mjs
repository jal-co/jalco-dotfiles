import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Manager } from '../src/manager.mjs';
import { Store } from '../src/store.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('stdio MCP works in a separate process without loading a coding agent', { timeout: 10000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rex-mcp-test-'));
  const child = spawn(process.execPath, [cli, 'mcp', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (value) => { stdout += value; });
  child.stderr.on('data', (value) => { stderr += value; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rex_agent_list', arguments: {} } },
  ].map(JSON.stringify).join('\n') + '\n');
  assert.equal((await closed)[0], 0, stderr);
  const replies = stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(replies.map((row) => row.id), [1, 2, 3]);
  assert.equal(replies[1].result.tools.length, 6);
  assert.deepEqual(JSON.parse(replies[2].result.content[0].text), []);
});

test('managed worktree uses explicit committed base and preserves principal edits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rex-worktree-test-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  writeFileSync(join(repo, 'file.txt'), 'committed\n');
  git('add', 'file.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  writeFileSync(join(repo, 'file.txt'), 'principal edit\n');
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'rex-worktree-state-')), 'state'));
  const manager = new Manager({ store, rex: { localServer: () => ({ instance: 'fixture', host: 'fixture' }), create: () => ({ session_id: 'session:fixture', initial_windows: [{ block_ids: ['block:fixture'] }] }) } });
  const row = manager.launch({ name: 'worktree-fixture', adapter: 'command', argv: ['true'], worktree: { repo, branch: 'feat/fixture', base: 'main' } });
  assert.equal(readFileSync(join(row.cwd, 'file.txt'), 'utf8'), 'committed\n');
  assert.equal(readFileSync(join(repo, 'file.txt'), 'utf8'), 'principal edit\n');
  assert.equal(row.worktree.base, git('rev-parse', 'main'));
  assert.match(git('worktree', 'list', '--porcelain'), /feat\/fixture/);
  assert.throws(() => manager.launch({ name: 'duplicate-branch', adapter: 'command', argv: ['true'], worktree: { repo, branch: 'feat/fixture', base: 'main' } }), /retained after launch uncertainty/);
});
