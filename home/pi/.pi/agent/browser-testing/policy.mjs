import { fileURLToPath } from 'node:url'

const preserved = new Set([
  'AGENT_BROWSER_SESSION', 'AGENT_BROWSER_RESTORE', 'AGENT_BROWSER_ENCRYPTION_KEY',
  'AGENT_BROWSER_COLOR_SCHEME', 'AGENT_BROWSER_SCREENSHOT_DIR',
  'AGENT_BROWSER_ALLOWED_DOMAINS', 'AGENT_BROWSER_ACTION_POLICY',
  'AGENT_BROWSER_CONFIRM_ACTIONS', 'AGENT_BROWSER_CONTENT_BOUNDARIES',
  'AGENT_BROWSER_MAX_OUTPUT', 'AGENT_BROWSER_DEFAULT_TIMEOUT',
])

export function browserEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    !key.startsWith('AGENT_BROWSER_') || preserved.has(key)))
  return {
    ...env,
    AGENT_BROWSER_CONFIG: fileURLToPath(new URL('./headless.json', import.meta.url)),
    AGENT_BROWSER_NAMESPACE: 'pi-headless',
    AGENT_BROWSER_HEADED: 'false',
    AGENT_BROWSER_AUTO_CONNECT: 'false',
    AGENT_BROWSER_ENGINE: 'chrome',
    AGENT_BROWSER_SCREENSHOT_FORMAT: 'png',
  }
}

const forbidden = new Set([
  '--headed', '--cdp', '--auto-connect', '--profile', '--executable-path',
  '--extension', '--extensions', '--args', '--provider', '-p', '--engine',
  '--config', '--namespace', '--session-name', '--all',
])
const commands = new Set([
  'open', 'goto', 'navigate', 'back', 'forward', 'reload', 'pushstate',
  'snapshot', 'read', 'get', 'is', 'screenshot', 'pdf', 'record', 'wait',
  'click', 'dblclick', 'focus', 'fill', 'type', 'press', 'key', 'keydown', 'keyup',
  'check', 'uncheck', 'select', 'hover', 'scroll', 'scrollintoview', 'scrollinto',
  'drag', 'upload', 'mouse', 'keyboard', 'touch', 'swipe', 'tap', 'find',
  'set', 'cookies', 'storage', 'network', 'tab', 'frame', 'dialog', 'eval',
  'state', 'session', 'auth', 'console', 'errors', 'trace', 'profiler', 'react', 'vitals', 'a11y',
  'diff', 'addinitscript', 'removeinitscript', 'close', 'quit', 'exit', 'batch',
])
const leadingValues = new Set(['--session', '--state', '--color-scheme', '--enable', '--init-script'])

export function validateBrowserArgs(args) {
  if (!args.length) throw new Error('A browser command is required')
  for (const arg of args) {
    if (forbidden.has(arg.split('=')[0]) || arg.startsWith('--session=')) {
      throw new Error(`Browser isolation forbids ${arg.split('=')[0]}`)
    }
  }
  let index = 0
  while (args[index]?.startsWith('-')) {
    const flag = args[index++]
    if (leadingValues.has(flag)) {
      if (!args[index] || args[index].startsWith('-')) throw new Error(`Missing value for ${flag}`)
      if (flag === '--session') validateSession(args[index])
      index++
    } else if (!['--json', '--restore'].includes(flag)) {
      throw new Error(`Unsupported leading option: ${flag}`)
    }
  }
  const command = args[index]
  if (!commands.has(command)) throw new Error(`Unsupported isolated browser command: ${command}`)
  if (args.includes('--session', index + 1)) throw new Error('Put --session before the command')
  return command
}

export function validateSession(session) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session) || session === 'default') {
    throw new Error('Use a named task browser session, not the shared default')
  }
  return session
}

export function validateBatch(input) {
  const commands = JSON.parse(input)
  if (!Array.isArray(commands) || !commands.length) throw new Error('Expected a non-empty batch array')
  for (const args of commands) {
    if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
      throw new Error('Expected batch commands to be string arrays')
    }
    if (validateBrowserArgs(args) === 'batch') throw new Error('Nested batches are not supported')
  }
  return JSON.stringify(commands)
}
