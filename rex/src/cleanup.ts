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

const sentence = (text) => `${String(text).trim().replace(/[.\s]+$/, '')}.`;
const reason = (error) => String(error?.message ?? error);

export async function forceCleanupTask({ id, checkout, preserve }, { store = new TaskStore(), inspect, stop, terminate, exited, detach, recheck, closeTab, checkouts, exists, remove, forget, reconcile, residual, timeout = 30_000, grace = 5_000, pause = 500 }) {
  const done = [];
  const kept = [];
  const current = () => store.list().find((row) => row.id === id || row.logicalId === id);
  const task = current();
  const name = task?.name ?? checkout ?? id;
  const wait = async (limit) => {
    const deadline = Date.now() + limit;
    while (!exited(task)) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
    return true;
  };
  if (task && !task.stopConfirmed) {
    const evidence = inspect(task);
    if (!evidence) return { ok: false, outcome: 'refused', text: `${name} belongs to a coordinator in another directory. Nothing was changed.` };
    if (evidence.state === 'owned') return { ok: false, outcome: 'refused', text: `${sentence(evidence.reason)} Nothing was changed.` };
    if (evidence.state === 'alive' || evidence.attached) {
      let stopped;
      try { stopped = await stop(task); } catch (error) { stopped = { ok: false, text: reason(error) }; }
      let gone = stopped.ok && await wait(timeout);
      if (!gone && evidence.state === 'alive' && terminate(task)) gone = await wait(grace);
      if (!gone && evidence.state === 'alive') return { ok: false, outcome: 'refused', text: `${name} is still running as its verified agent process, so nothing was retired or removed. ${sentence(stopped.text)}` };
    }
    if (!current()?.stopConfirmed) {
      try {
        const retired = detach(task);
        if (retired?.status === 'detached') kept.push(`${sentence(retired.reason)} Nothing was signalled`);
        else if (retired) done.push(sentence(retired.reason));
        if (retired?.tab) kept.push(`Kept its tab open: ${retired.tab}`);
      } catch (error) {
        return { ok: false, outcome: 'refused', text: `${sentence(reason(error))} Nothing was removed.` };
      }
    } else done.push(`${name} stopped.`);
  } else if (task?.detached) {
    const evidence = recheck(task);
    if (evidence?.state === 'crashed') done.push(sentence(`Its exit is now confirmed: ${evidence.reason}`));
    else if (evidence) kept.push(`${sentence(`Its exit is still unconfirmed: ${evidence.reason}`)} Nothing was signalled`);
    if (evidence?.tab) kept.push(`Kept its tab open: ${evidence.tab}`);
  } else if (task) {
    const busy = closeTab(task);
    if (busy) kept.push(`Kept its tab open: ${busy}`);
  }
  if (checkout) {
    const record = checkouts().find((row) => row.path === checkout && !row.removed);
    if (!record) {
      reconcile();
      done.push('Its checkout was already removed.');
    } else {
      try {
        done.push(sentence(exists(checkout) ? await remove(checkout, preserve) : await forget(checkout)));
        reconcile();
      } catch (error) {
        kept.push(`Kept ${checkout}: ${reason(error)}`);
        residual(checkout, kept.map(sentence).join(' '));
      }
    }
  }
  if (task) {
    store.exclusive(task.id, () => {
      const latest = store.read(task.id);
      latest.forced = { at: Date.now(), kept };
      store.write(latest);
    });
  }
  if (kept.length) return { ok: true, outcome: 'partial', text: [`Partly cleaned up ${name}.`, ...kept.map(sentence), ...done].join(' ') };
  return { ok: true, outcome: 'cleaned', text: [`Force cleaned up ${name}.`, ...done].join(' ') };
}
