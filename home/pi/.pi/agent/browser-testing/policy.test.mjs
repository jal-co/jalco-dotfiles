import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { browserEnvironment, validateBatch, validateBrowserArgs, validateSession } from './policy.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

test('launch settings cannot inherit a visible browser or personal attachment', () => {
  const env = browserEnvironment({
    PATH: '/bin', AGENT_BROWSER_SESSION: 'my-task', AGENT_BROWSER_HEADED: 'true',
    AGENT_BROWSER_AUTO_CONNECT: 'true', AGENT_BROWSER_CDP: '9222',
    AGENT_BROWSER_PROFILE: 'Default', AGENT_BROWSER_ARGS: '--user-data-dir=personal',
    AGENT_BROWSER_PROVIDER: 'ios', AGENT_BROWSER_EXECUTABLE_PATH: '/Applications/Dia',
    AGENT_BROWSER_PLUGINS: '[{}]', AGENT_BROWSER_CONFIG: '/tmp/unsafe.json',
    AGENT_BROWSER_NAMESPACE: 'personal', AGENT_BROWSER_ENGINE: 'safari',
  })
  assert.equal(env.AGENT_BROWSER_HEADED, 'false')
  assert.equal(env.AGENT_BROWSER_AUTO_CONNECT, 'false')
  assert.equal(env.AGENT_BROWSER_NAMESPACE, 'pi-headless')
  assert.equal(env.AGENT_BROWSER_ENGINE, 'chrome')
  assert.equal(env.AGENT_BROWSER_SESSION, 'my-task')
  assert.equal(env.PATH, '/bin')
  for (const key of ['CDP', 'PROFILE', 'ARGS', 'PROVIDER', 'EXECUTABLE_PATH', 'PLUGINS']) {
    assert.equal(env[`AGENT_BROWSER_${key}`], undefined)
  }
  assert.equal(JSON.parse(readFileSync(env.AGENT_BROWSER_CONFIG)).headed, false)
})

test('rejects attachment, visible launch, configuration escapes and nested batches', () => {
  for (const flag of ['--headed', '--cdp', '--auto-connect', '--profile', '--args', '--provider', '-p', '--engine', '--config', '--namespace', '--executable-path', '--extension', '--all']) {
    assert.throws(() => validateBrowserArgs(['open', 'about:blank', flag, 'value']))
    assert.throws(() => validateBrowserArgs([`${flag}=value`, 'open', 'about:blank']))
    assert.throws(() => validateBatch(JSON.stringify([['open', 'about:blank', flag, 'value']])))
  }
  for (const command of ['connect', 'inspect', 'mcp', 'chat', 'plugin', 'dashboard']) {
    assert.throws(() => validateBrowserArgs([command]))
  }
  assert.throws(() => validateBatch('[["batch","[]"]]'))
  assert.throws(() => validateBatch('["open"]'))
  assert.throws(() => validateSession('default'))
  assert.throws(() => validateSession('../personal'))
  assert.throws(() => validateBrowserArgs(['--session=default', 'open']))
  assert.throws(() => validateBrowserArgs(['--session', 'default', 'open']))
  assert.equal(validateBrowserArgs(['--session', 'test-task', '--json', '--restore', 'snapshot', '-i']), 'snapshot')
  assert.equal(validateBrowserArgs(['react', 'inspect', '12']), 'react')
  assert.equal(validateBatch('[["click","@e1"],["screenshot","result.png"]]'), '[["click","@e1"],["screenshot","result.png"]]')
})

test('launcher and Mastra wrapper share isolation, batch validation and failure propagation', () => {
  const temp = mkdtempSync(join(tmpdir(), 'browser-policy-'))
  const bin = join(temp, 'bin')
  mkdirSync(bin)
  const log = join(temp, 'calls.jsonl')
  const fake = join(bin, 'agent-browser')
  const session = `policy-test-${process.pid}`
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ args, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('AGENT_BROWSER_'))), input: args.includes('batch') ? fs.readFileSync(0, 'utf8') : undefined }) + '\\n');
if (args[0] === 'session' && args[1] === 'id') console.log('${session}');
else if (args[0] === 'state' && args[1] === 'list') console.log('{"data":{"files":[]}}');
else if (process.env.TEST_FAIL) process.exit(7);
`, { mode: 0o700 })
  writeFileSync(join(temp, 'agent-browser.json'), '{"headed":true,"cdp":"9222"}')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, AGENT_BROWSER_HEADED: 'true', AGENT_BROWSER_CDP: '9222', AGENT_BROWSER_SESSION: session, AGENT_BROWSER_MASTRA_AUTH_STATE: join(temp, 'missing-auth.json') }
  const invoke = (file, args, extra = {}) => spawnSync(join(root, file), args, { env, cwd: temp, encoding: 'utf8', ...extra })
  try {
    const start = invoke('task-browser', ['start', 'about:blank'])
    assert.equal(start.status, 0, start.stderr)
    let calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls.map(call => call.args), [['open', 'about:blank'], ['set', 'viewport', '1440', '1000'], ['set', 'media', 'dark']])
    for (const call of calls) {
      assert.equal(call.env.AGENT_BROWSER_HEADED, 'false')
      assert.equal(call.env.AGENT_BROWSER_CDP, undefined)
      assert.equal(call.env.AGENT_BROWSER_NAMESPACE, 'pi-headless')
      assert.equal(call.env.AGENT_BROWSER_RESTORE, session)
      assert.equal(call.env.AGENT_BROWSER_CONFIG, join(root, 'headless.json'))
    }
    assert.equal(invoke('task-browser', ['batch', '--bail'], { input: '[["click","@e1"],["snapshot","-i"]]' }).status, 0)
    calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(calls.at(-1).input, '[["click","@e1"],["snapshot","-i"]]')
    assert.equal(invoke('task-browser', ['batch', '["connect","9222"]']).status, 1)
    assert.equal(invoke('task-browser', ['start', '--headed']).status, 1)
    assert.equal(invoke('task-browser', ['close', '--all']).status, 1)
    assert.equal(invoke('task-browser', ['snapshot'], { env: { ...env, TEST_FAIL: '1' } }).status, 7)
    assert.equal(invoke('mastra-browser', ['start', 'about:blank']).status, 0)
    assert.equal(invoke('mastra-browser', ['auth-import-dia', 'https://example.com']).status, 1)
    assert.equal(invoke('task-browser', ['review', 'javascript:alert(1)']).status, 1)
    assert.equal(invoke('task-browser', ['review', 'https://user:pass@example.com']).status, 1)
  } finally {
    unlinkSync(fake)
    rmdirSync(bin)
    for (const name of readdirSync(temp)) unlinkSync(join(temp, name))
    rmdirSync(temp)
    rmdirSync(join(tmpdir(), 'agent-browser-artifacts', session))
  }
})
