export function findCoordinator(sessions, inspect, cwd, labels = ['Command', 'pinned']) {
  const running = sessions.filter((session) => inspect(session.session_id).some((info) =>
    !info.last_exit && [info.foreground, ...(info.ancestors ?? [])].some((process) => process?.argv0 === 'pi' && process.cwd === cwd)));
  if (running.length > 1) throw new Error('Multiple live Rex coordinators use this directory. Select the intended session manually.');
  if (running.length === 1) return running[0];
  const stopped = sessions.filter((session) => labels.includes(session.label));
  if (stopped.length > 1) throw new Error(`Several ${labels.join(' or ')} sessions exist and none runs the coordinator. Close the extras before restarting.`);
  return stopped[0] && { ...stopped[0], stopped: true };
}
