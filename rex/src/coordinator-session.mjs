import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function findCoordinator(sessions, inspect, cwd, labels = ['Command', 'pinned']) {
  const running = sessions.filter((session) => inspect(session.session_id).some((info) =>
    !info.last_exit && [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd)));
  if (running.length > 1) throw new Error('Multiple live Rex coordinators use this directory. Select the intended session manually.');
  if (running.length === 1) return running[0];
  const stopped = sessions.filter((session) => labels.includes(session.label));
  if (stopped.length > 1) throw new Error(`Several ${labels.join(' or ')} sessions exist and none runs the coordinator. Close the extras before restarting.`);
  return stopped[0] && { ...stopped[0], stopped: true };
}

const plainSession = /^[0-9TZ-]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

const firstLine = (file) => {
  const buffer = Buffer.alloc(4096);
  const fd = openSync(file, 'r');
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8').split('\n', 1)[0];
  } finally {
    closeSync(fd);
  }
};

export const sessionDirFor = (cwd, agentDir) => join(agentDir, 'sessions', `--${resolve(cwd).replace(/^\//, '').replace(/[/:]/g, '-')}--`);

export function latestCoordinatorSession(cwd, agentDir, taskSessions = []) {
  const dir = sessionDirFor(cwd, agentDir);
  if (!existsSync(dir)) return undefined;
  const claimed = new Set(taskSessions);
  const names = readdirSync(dir);
  const candidates = names.filter((name) => plainSession.test(name)
    && !names.some((other) => other.startsWith(`${name}.pi-herdr-subagent-policy`) || other.startsWith(`${name}.rex-process-`)))
    .map((name) => join(dir, name))
    .filter((file) => !claimed.has(file))
    .filter((file) => {
      try {
        const header = JSON.parse(firstLine(file));
        return header.type === 'session' && header.cwd === cwd;
      } catch {
        return false;
      }
    });
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
