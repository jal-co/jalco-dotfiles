const key = Symbol.for('justin.rex.agent-infrastructure');

export function infrastructureFor(session, create) {
  const entries = globalThis[key] ??= new Map();
  if (!entries.has(session)) entries.set(session, create());
  return entries.get(session);
}

export function releaseInfrastructure(session, reason) {
  if (['reload', 'new', 'resume', 'fork'].includes(reason)) return;
  const entries = globalThis[key];
  const infrastructure = entries?.get(session);
  infrastructure?.supervision?.close();
  entries?.delete(session);
}
