import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../bin/rex-check', import.meta.url));

test('missing commands return usage without starting a job', () => {
  const result = spawnSync('/bin/sh', [script], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: rex-check/);
});

test('missing resource controls fail closed instead of running an unbounded job', (t) => {
  const bin = mkdtempSync(join(tmpdir(), 'rex-check-'));
  symlinkSync('/usr/bin/false', join(bin, 'systemctl'));
  symlinkSync('/usr/bin/true', join(bin, 'systemd-run'));
  t.after(() => {
    unlinkSync(join(bin, 'systemctl'));
    unlinkSync(join(bin, 'systemd-run'));
    rmdirSync(bin);
  });
  const result = spawnSync('/bin/sh', [script, 'echo', 'must not run'], { encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires the installed app-rexchecks.slice/);
  assert.equal(result.stdout, '');
});

test('verification uses the shared disk-backed Turbo cache unless explicitly overridden', (t) => {
  const bin = mkdtempSync(join(tmpdir(), 'rex-check-cache-'));
  writeFileSync(join(bin, 'systemctl'), "printf '8s\\n'\n", { mode: 0o700 });
  writeFileSync(join(bin, 'systemd-run'), 'printf \'%s\\n\' "$TURBO_CACHE_DIR"\n', { mode: 0o700 });
  t.after(() => {
    unlinkSync(join(bin, 'systemctl'));
    unlinkSync(join(bin, 'systemd-run'));
    rmdirSync(bin);
  });
  for (const cache of ['', '/custom/cache with spaces']) {
    const result = spawnSync('/bin/sh', [script, 'echo', 'unused'], { encoding: 'utf8', env: { ...process.env, PATH: bin, HOME: '/home/cache user', TURBO_CACHE_DIR: cache } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), cache || '/home/cache user/.cache/turbo');
  }
});

test('real Linux scopes preserve arguments, streams, environment, cwd and exit status', { skip: process.env.REX_CHECK_LIVE !== '1' }, () => {
  const code = "const fs=require('node:fs'); console.log(JSON.stringify({arg:process.argv[1],cwd:process.cwd(),env:process.env.REX_CHECK_TEST,input:fs.readFileSync(0,'utf8'),cgroup:fs.readFileSync('/proc/self/cgroup','utf8')})); console.error('stderr preserved'); process.exit(7)";
  const result = spawnSync('/bin/sh', [script, process.execPath, '-e', code, '$HOME literal spaces'], { encoding: 'utf8', input: 'stdin preserved', cwd: tmpdir(), env: { ...process.env, REX_CHECK_TEST: 'environment preserved' } });
  assert.equal(result.status, 7, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.arg, '$HOME literal spaces');
  assert.equal(output.cwd, tmpdir());
  assert.equal(output.env, 'environment preserved');
  assert.equal(output.input, 'stdin preserved');
  assert.match(output.cgroup, /\/app.slice\/app-rexchecks.slice\//);
  assert.match(result.stderr, /stderr preserved/);
});
