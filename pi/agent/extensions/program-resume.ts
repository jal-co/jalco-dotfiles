import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

declare global {
  var programResumeToken: string | undefined;
  var programResumeCleanup: (() => void) | undefined;
}

const tokenPattern = /^[A-Za-z0-9_-]{22,64}$/;
const controlCharacter = /\p{Cc}/u;
const maxLength = 2048;
const keptFlags = new Set(['--approve', '-a']);
const droppedFlags = new Set(['--continue', '-c', '--resume', '-r']);
const droppedFlagsWithValue = new Set(['--model', '--session', '--session-id', '--name', '-n']);

export const takeToken = (env: NodeJS.ProcessEnv = process.env) => {
  const token = env.OSC7577_TOKEN;
  delete env.OSC7577_TOKEN;
  if (token && tokenPattern.test(token)) globalThis.programResumeToken = token;
  return globalThis.programResumeToken;
};

export const keptLaunchFlags = (args: string[]) => {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') continue;
    const name = arg.split('=', 1)[0];
    if (keptFlags.has(arg)) { if (!kept.includes('--approve')) kept.push('--approve'); continue; }
    if (droppedFlags.has(arg)) continue;
    if (droppedFlagsWithValue.has(name)) { if (name === arg) index += 1; continue; }
    return undefined;
  }
  return kept;
};

export const within = (path: string, root: string) => {
  try {
    return realpathSync(path).startsWith(realpathSync(root) + sep);
  } catch {
    return false;
  }
};

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64');

export const sequence = (body: string, token: string) =>
  `\u001b]7577;${body}:mac=${createHash('sha256').update(`${body}:${token}`).digest('hex')}\u001b\\`;

export const report = (argv: string[], cwd: string, pid: number, time: number, token: string) => {
  if (!argv.length || !argv[0] || !isAbsolute(cwd) || [...argv, cwd].some((part) => controlCharacter.test(part))) return undefined;
  const text = sequence(`pid=${pid}:time=${time}:argv=${argv.map(encode).join(',')}:cwd=${encode(cwd)}`, token);
  return Buffer.byteLength(text) <= maxLength ? text : undefined;
};

export const clear = (pid: number, time: number, token: string) => sequence(`pid=${pid}:time=${time}:clear=1`, token);

type Options = {
  env?: NodeJS.ProcessEnv;
  args?: string[];
  script?: string;
  home?: string;
  write?: (text: string) => void;
  now?: () => number;
  pid?: number;
};

export default function programResume(pi: Pick<ExtensionAPI, 'on'>, options: Options = {}) {
  const env = options.env ?? process.env;
  const token = takeToken(env);
  globalThis.programResumeCleanup?.();
  const home = options.home ?? homedir();
  const sessions = join(home, '.pi/agent/sessions');
  const flags = keptLaunchFlags(options.args ?? process.argv.slice(2));
  const managedInstall = within(options.script ?? process.argv[1] ?? '', join(home, '.pi/agent/install/releases'));
  const managedAgent = env.PI_REX_AGENT === '1' || Boolean(env.PI_SUBAGENT_ID);
  if (!token || managedAgent || !flags || !managedInstall) return;
  const write = options.write ?? ((text: string) => { process.stdout.write(text); });
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const pid = options.pid ?? process.pid;
  let enabled = false;
  let last: string | undefined;
  let sessionFile: () => string | undefined = () => undefined;
  let cwd = '';

  const sync = (force = false) => {
    if (!enabled) return;
    const file = sessionFile();
    const saved = file && isAbsolute(file) && existsSync(file) && within(file, sessions) ? realpathSync(file) : undefined;
    const argv = saved ? ['pi', '--session', saved, ...flags] : undefined;
    const key = argv ? JSON.stringify([argv, cwd]) : 'clear';
    if (!force && key === last) return;
    const text = argv ? report(argv, cwd, pid, now(), token) : undefined;
    last = text ? key : 'clear';
    write(text ?? clear(pid, now(), token));
  };
  const resumed = () => sync(true);

  const unsubscribe = [
    pi.on('session_start', (_event, ctx) => {
      enabled = ctx.mode === 'tui' && ctx.sessionManager.isPersisted();
      sessionFile = () => ctx.sessionManager.getSessionFile();
      cwd = ctx.cwd;
      sync(true);
    }),
    pi.on('message_end', () => sync()),
    pi.on('agent_settled', () => sync()),
    pi.on('session_compact', () => sync()),
    pi.on('session_tree', () => sync()),
    pi.on('session_shutdown', () => close()),
  ];
  process.on('SIGCONT', resumed);
  const close = () => {
    enabled = false;
    unsubscribe.forEach((off) => off?.());
    process.off('SIGCONT', resumed);
    if (globalThis.programResumeCleanup === close) globalThis.programResumeCleanup = undefined;
  };
  globalThis.programResumeCleanup = close;
}
