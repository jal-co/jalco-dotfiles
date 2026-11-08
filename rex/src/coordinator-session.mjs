export function findCoordinator(sessions, inspect, cwd) {
  const running = sessions.filter((session) => inspect(session.session_id).some((info) =>
    !info.last_exit && [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd)));
  if (running.length > 1) throw new Error('Multiple live Rex coordinators use this directory. Select the intended session manually.');
  if (running.length === 1) return running[0];
  const stopped = sessions.filter((session) => session.label === 'pinned');
  if (stopped.length > 1) throw new Error('Several pinned sessions exist and none runs the coordinator. Close the extras before restarting.');
  return stopped[0] && { ...stopped[0], stopped: true };
}
