export function findCoordinator(sessions, inspect, cwd) {
  const running = sessions.filter((session) => inspect(session.session_id).some((info) =>
    !info.last_exit && [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd)));
  if (running.length > 1) throw new Error('Multiple live Rex coordinators use this directory. Select the intended session manually.');
  if (running.length === 1) return running[0];
  if (sessions.some((session) => session.label === 'pinned')) throw new Error('A pinned session exists but its coordinator is not running. Inspect it before restarting.');
  return undefined;
}
