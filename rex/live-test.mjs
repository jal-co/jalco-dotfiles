import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RexSurfaceProvider } from './provider.mjs';
import { RexWorktrees, git } from './worktrees.mjs';

if (!process.env.REX_SESSION) throw new Error('Run this test in a dedicated Rex terminal.');
const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(homedir(), '.pi/agent/herdr-agents/config.json'), 'utf8'));
const reportDir = process.env.REX_PROOF_DIR;
if (!reportDir) throw new Error('Set REX_PROOF_DIR to a new task-specific report directory.');
mkdirSync(reportDir, { recursive: true });
const repo = join(realpathSync(reportDir), 'repo');
if (existsSync(repo)) throw new Error('Test repository already exists. Use a fresh report directory.');
mkdirSync(repo);
git(repo, ['init', '-b', 'main']);
git(repo, ['config', 'user.name', 'Rex test']);
git(repo, ['config', 'user.email', 'rex-test@example.invalid']);
writeFileSync(join(repo, 'base.txt'), 'Disposable Rex integration test\n');
git(repo, ['add', 'base.txt']);
git(repo, ['commit', '-m', 'Initial Rex test fixture']);
const base = git(repo, ['rev-parse', 'HEAD']).trim();
const branch = `test/rex-${Date.now()}`;
mkdirSync(join(reportDir, '.pi'));
symlinkSync(join(root, 'coordinator/settings.json'), join(reportDir, '.pi/settings.json'));
const manager = new RexWorktrees(new RexSurfaceProvider());
const child = spawn(join(homedir(), '.pi/agent/bin/pi'), [
  '--mode', 'rpc', '--approve', '--no-mcp', '--no-skills', '--no-context-files',
  '--extension', join(root, 'live-test-extension.ts'), '--model', config.models.default, '--thinking', 'low',
  '--tools', 'subagent,subagent_send,subagent_stop,worktree_list,worktree_remove',
  '--append-system-prompt', 'You are testing Rex orchestration against a disposable fixture. Execute exactly the requested tool call without extra investigation. For this fixture explicitly use a managed worktree even though it has no remote. On automatic subagent_result messages reply only ACK. Never run more than one live task agent, read files, or run commands in the coordinator. Cleanup of this disposable fixture is approved only when explicitly requested by the test.',
], { cwd: reportDir, stdio: ['pipe', 'pipe', 'pipe'] });
const events = [];
let stage = 'first';
let results = 0;
let stopped = false;
let reloaded = false;
let dirtyRefused = false;
let removed = false;
let record;
let buffer = '';
let stderr = '';
let failure;
let finished = false;
let pending = Promise.resolve();
const send = (message, id) => child.stdin.write(`${JSON.stringify({ type: 'prompt', message, id })}\n`);
const fail = (error) => { failure = String(error); child.stdin.end(); };
const timeout = setTimeout(() => fail('Live Rex test exceeded 240 seconds. Inspect its retained agents before retrying.'), 240_000);

async function onEvent(event) {
  events.push(event);
  if (event.type === 'extension_ui_request' && event.method === 'confirm') {
    assert.equal(event.title, 'Remove Rex worktree?');
    assert.ok(event.message.includes(record.path));
    child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: event.id, confirmed: true })}\n`);
  }
  if (event.type === 'response' && event.command === 'get_state') {
    assert.equal(event.success, true, JSON.stringify(event));
    send(`Call subagent exactly once with name rex-proof-test, persistent true, interactive true, fork false, model task:recon, thinking low, tools bash,subagent_done, cwd ${repo}, worktree {branch:"${branch}",base:"${base}"}, task: "Disposable worktree test. Only in your assigned cwd, run printf 'REX_FIRST_OK\\n' > first.txt. Say REX_FIRST_OK, then call subagent_done. Stay alive for a follow-up." Wait for the automatic result.`);
  }
  if (event.type === 'response' && event.id === 'reload') {
    assert.equal(event.success, true, JSON.stringify(event));
    assert.equal(event.data.disposition, 'handled');
    reloaded = true;
    stage = 'second';
    send('Call subagent_send for name rex-proof-test with message: "Second disposable test. Only in your assigned cwd, run printf REX_SECOND_OK > second.txt. Say REX_SECOND_OK, then call subagent_done. Do not modify other files." Wait for its automatic result.');
  }
  if (event.type === 'message_end' && event.message?.customType === 'subagent_result') {
    results++;
    const expected = results === 1 ? 'REX_FIRST_OK' : results === 2 ? 'REX_SECOND_OK' : 'REX_REUSE_OK';
    assert.ok(JSON.stringify(event.message).includes(expected), `Result ${results} did not contain ${expected}: ${JSON.stringify(event.message)}`);
    console.log(`Automatic result ${results} received`);
  }
  if (event.type === 'message_end' && event.message?.customType === 'subagent_stop') {
    assert.equal(event.message.details?.status, 'stopped', JSON.stringify(event.message));
    stopped = true;
  }
  if (event.type === 'tool_execution_end') {
    if (event.toolName === 'worktree_remove' && stage === 'refuse-dirty') {
      assert.equal(event.isError, true, 'Dirty checkout must block non-preserving cleanup');
      assert.equal(existsSync(record.path), true);
      dirtyRefused = true;
    } else {
      assert.equal(event.isError, false, JSON.stringify(event));
      if (event.toolName === 'worktree_remove' && stage === 'remove') removed = true;
    }
  }
  if (event.type !== 'agent_settled' || failure) return;
  if (stage === 'first' && results === 1) {
    stage = 'reloading';
    record = manager.records().find((entry) => entry.repo === repo);
    assert.ok(record, 'Worktree ownership record is missing');
    assert.equal(readFileSync(join(record.path, 'first.txt'), 'utf8').trim(), 'REX_FIRST_OK');
    assert.equal(existsSync(join(repo, 'first.txt')), false);
    await assert.rejects(manager.create({ name: 'duplicate', cwd: repo, branch, base }), /live Rex coordinator/);
    send('/rex-proof-reload', 'reload');
  } else if (stage === 'second' && results === 2) {
    stage = 'stopping';
    assert.equal(readFileSync(join(record.path, 'second.txt'), 'utf8'), 'REX_SECOND_OK');
    send('Call subagent_stop for name rex-proof-test. Do not launch another agent.');
  } else if (stage === 'stopping' && stopped) {
    stage = 'reuse';
    assert.equal(manager.records().find((entry) => entry.repo === repo).lease, null);
    stopped = false;
    send(`The previous task agent has confirmed stopped. Call subagent exactly once with name rex-proof-reuse, persistent true, interactive true, fork false, model task:recon, thinking low, tools bash,subagent_done, cwd ${repo}, worktree {branch:"${branch}",base:"${base}"}, task: "Disposable reuse test. Only in your assigned cwd, run printf REX_REUSE_OK > third.txt. Say REX_REUSE_OK, then call subagent_done. Preserve existing files." Wait for its automatic result.`);
  } else if (stage === 'reuse' && results === 3) {
    stage = 'stop-reuse';
    const reused = manager.records().find((entry) => entry.repo === repo);
    assert.equal(reused.path, record.path);
    assert.equal(reused.workspaceId, record.workspaceId);
    assert.equal(reused.surfaceId, record.surfaceId);
    assert.notEqual(reused.manifest.value.id, record.manifest.value.id);
    assert.equal(readFileSync(join(record.path, 'third.txt'), 'utf8'), 'REX_REUSE_OK');
    send('Call subagent_stop for name rex-proof-reuse. Do not launch another agent.');
  } else if (stage === 'stop-reuse' && stopped) {
    stage = 'inventory';
    assert.equal(manager.records().find((entry) => entry.repo === repo).lease, null);
    send('Call worktree_list once and report its result. Do not remove anything.');
  } else if (stage === 'inventory') {
    stage = 'refuse-dirty';
    send(`Call worktree_remove exactly once with target "${record.path}" and preserve false. This disposable test expects a dirty-checkout refusal. Do not retry, preserve, or modify files.`);
  } else if (stage === 'refuse-dirty' && dirtyRefused) {
    stage = 'remove';
    send(`Explicit cleanup approval for this disposable test only. Call worktree_remove exactly once with target "${record.path}" and preserve true. Keep the branch and commits.`);
  } else if (stage === 'remove' && removed) {
    assert.equal(existsSync(record.path), false);
    assert.equal(git(repo, ['show', `${branch}:first.txt`]).trim(), 'REX_FIRST_OK');
    assert.equal(git(repo, ['show', `${branch}:second.txt`]).trim(), 'REX_SECOND_OK');
    assert.equal(git(repo, ['show', `${branch}:third.txt`]).trim(), 'REX_REUSE_OK');
    assert.equal(manager.records().find((entry) => entry.repo === repo).removed, true);
    finished = true;
    child.stdin.end();
  }
}

child.stderr.on('data', (chunk) => { stderr += chunk; });
child.on('error', fail);
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { fail(`Invalid RPC output: ${line}`); continue; }
    if (event.type === 'message_update') continue;
    pending = pending.then(() => onEvent(event)).catch(fail);
  }
});
child.stdin.write(`${JSON.stringify({ type: 'get_state' })}\n`);
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
await pending;
if (exitCode !== 0 && !failure) failure = `Coordinator exited with code ${exitCode}: ${stderr}`;
clearTimeout(timeout);
writeFileSync(join(reportDir, 'events.json'), JSON.stringify(events, null, 2));
writeFileSync(join(reportDir, 'stderr.txt'), stderr);
const outcome = { results, reloaded, stopped, dirtyRefused, removed, finished, failure: failure ?? null, parentRexSession: process.env.REX_SESSION, worktree: record?.path, branch, repo };
writeFileSync(join(reportDir, 'result.json'), JSON.stringify(outcome, null, 2));
console.log(JSON.stringify(outcome));
assert.equal(failure, undefined);
assert.equal(results, 3);
assert.equal(reloaded, true);
assert.equal(stopped, true);
assert.equal(dirtyRefused, true);
assert.equal(removed, true);
assert.equal(finished, true);
