import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function processIdentity(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0, 'Invalid PID');
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { pid, birth: `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}` };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
      throw error;
    }
  }
  assert.equal(process.platform, 'darwin', 'Process verification supports macOS and Linux only');
  try {
    const birth = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();
    return birth ? { pid, birth } : null;
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

export function identityAlive(identity, probe = processIdentity) {
  assert.ok(identity?.birth && Number.isInteger(identity.pid), 'Process identity is unverified');
  return probe(identity.pid)?.birth === identity.birth;
}
