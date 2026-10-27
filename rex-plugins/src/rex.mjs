import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export const rexBinary = () => process.env.REX_PLUGINS_REX ?? 'rex';

export function callRex(args) {
  return execFileSync(rexBinary(), ['--autostart=false', '--timeout', '10s', ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export class Rex {
  constructor(call = callRex) { this.call = call; }
  api(method, args = {}) { return JSON.parse(this.call(['api', 'call', method, JSON.stringify(args)])); }
  localServer() {
    const identity = JSON.parse(this.call(['whoami', '--json']));
    assert.ok(identity.endpoint?.startsWith('unix://'), 'This build requires a local Rex Unix socket');
    assert.ok(typeof identity.instance_id === 'string' && typeof identity.host_id === 'string', 'Rex server identity is unavailable');
    return { instance: identity.instance_id, host: identity.host_id };
  }
  create(name, layout) {
    return this.api('session.create', { label: name, initial_windows: [{ window_label: name, layout }] });
  }
  presence(binding) {
    const server = this.localServer();
    assert.deepEqual(server, binding.server, 'Rex server changed; reconcile retained run manually');
    const sessions = this.api('session.list').sessions;
    assert.ok(sessions === null || Array.isArray(sessions), 'Invalid session inventory');
    if (!(sessions ?? []).some((row) => row.session_id === binding.session)) return 'missing';
    const blocks = this.api('session.list_blocks', { session_id: binding.session }).blocks;
    assert.ok(blocks === null || Array.isArray(blocks), 'Invalid block inventory');
    return (blocks ?? []).some((row) => row.block_id === binding.block) ? 'present' : 'missing';
  }
  capture(binding) {
    assert.equal(this.presence(binding), 'present', 'Retained terminal is missing');
    const result = JSON.parse(this.call(['block', 'call', '-s', binding.session, '-b', binding.block, 'format', JSON.stringify({ format: 'text', trim: true, unwrap: true, max_bytes: 32768 })]));
    assert.equal(typeof result.content, 'string', 'Invalid terminal capture');
    return { text: result.content, truncated: result.id !== undefined };
  }
}

export function terminal(label, cwd, argv) {
  return { block: { flavor: 'com.superlogical.terminal.shell', label, options: { shell: 'none', cwd, command: argv, exit: { on_completion: false } } } };
}

export function taskLayout({ name, cwd, runner, view, details, panels }) {
  const agent = terminal(name, cwd, runner);
  if (!panels) return agent;
  return { split: { direction: 'horizontal', ratio: 0.7, before: agent, after: { split: { direction: 'vertical', ratio: 0.5, before: terminal('Task status', cwd, view), after: terminal('Task details', cwd, details) } } } };
}
