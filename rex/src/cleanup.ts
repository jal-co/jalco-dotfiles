import { TaskStore } from './tasks.ts';

export async function cleanupTask({ id, checkout, preserve }, { store = new TaskStore(), stop, exited, checkouts, remove, reconcile, timeout = 30_000, pause = 500 }) {
  const steps = [];
  const task = store.list().find((row) => row.id === id || row.logicalId === id);
  if (task && !task.stopConfirmed) {
    const stopped = await stop(task);
    steps.push(stopped.text);
    if (!stopped.ok) return { ok: false, text: steps.join(' ') };
    const deadline = Date.now() + timeout;
    while (!exited(task)) {
      if (Date.now() > deadline) return { ok: false, text: `${steps.join(' ')} ${task.name} has not exited yet. Clean up again once it stops.` };
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
  if (!checkouts().some((record) => !record.removed && record.path === checkout)) {
    reconcile();
    return { ok: true, text: [...steps, 'Its checkout was already removed.'].join(' ') };
  }
  steps.push(await remove(checkout, preserve));
  return { ok: true, text: steps.join(' ') };
}
