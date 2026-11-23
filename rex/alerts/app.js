const $ = (selector) => document.querySelector(selector);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  node.append(...children.filter(Boolean));
  return node;
};

async function api(path, body) {
  const headers = new Headers({ 'x-rex-phone': '1' });
  if (body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  return response.json();
}

const waited = (since) => {
  const minutes = Math.floor((Date.now() - since) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};
const ago = (since) => (waited(since) === 'now' ? 'just now' : `${waited(since)} ago`);
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const size = (bytes) => (bytes >= 1024 ** 3 ? gib(bytes) : `${Math.round(bytes / 1024 ** 2)} MiB`);
const clock = (time) => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const label = (text) => String(text ?? '').replace(/\p{Co}/gu, '').replace(/\s+/g, ' ').trim();
const GAP = '   ';

const STATUS = {
  stale: { label: '! stale', dot: 'red', stoppable: true },
  unsure: { label: '? owner unsure', dot: 'yellow', stoppable: true },
  owned: { label: '', dot: '', stoppable: false },
  protected: { label: '', dot: '', stoppable: false },
};

const ui = { view: 'asks', mode: 'list', selected: undefined, status: undefined, machine: undefined, machineError: false, waiting: undefined, waitingError: false, waitingAt: undefined, stopping: false };
const alertsLine = el('p', { class: 'alerts', role: 'status' });

const processKey = (row) => `${row.pid}:${row.start}`;
const stoppable = (item) => Boolean(item?.process && STATUS[item.process.status].stoppable);

function machineRows(machine) {
  const items = (section, list) => list.map((process) => ({ kind: 'item', key: `${section}:${processKey(process)}`, process }));
  const section = (title, list, empty) => [{ kind: 'section', title, count: list.length }, ...(list.length ? list : [{ kind: 'note', text: empty }])];
  return [
    ...section('Needs attention', items('a', machine.attention), 'Nothing stale. Every dev server and browser has a living owner.'),
    ...section('Most memory', items('m', machine.memoryTop), 'Nothing to show.'),
    ...section('Most CPU right now', items('c', machine.cpuTop), 'Nothing is busy right now.'),
  ];
}

const items = () => (ui.view === 'machine' && ui.machine ? machineRows(ui.machine).filter((row) => row.kind === 'item') : []);
const selectedItem = () => items().find((item) => item.key === ui.selected);
const findProcess = (key) => (ui.machine ? [...ui.machine.attention, ...ui.machine.memoryTop, ...ui.machine.cpuTop].find((row) => processKey(row) === key) : undefined);

function keepSelection(previous) {
  const list = items();
  if (!list.length) { ui.selected = undefined; return; }
  if (list.some((item) => item.key === ui.selected)) return;
  const index = previous.findIndex((item) => item.key === ui.selected);
  ui.selected = list[Math.min(Math.max(index, 0), list.length - 1)].key;
}

function processMeta(row) {
  return [label(sentence(row.reason)), row.tab && !row.reason.includes(row.tab) ? label(row.tab) : '', size(row.rss), row.cpu >= 1 ? `${Math.round(row.cpu)}% CPU` : '', `started ${ago(row.startedAt)}`]
    .filter(Boolean).join(GAP);
}

function itemRow(item) {
  const row = item.process;
  const selected = item.key === ui.selected;
  const right = [row.ports.length ? `:${row.ports.join(' :')}` : '', `pid ${row.pid}`].filter(Boolean).join('  ');
  return el('button', {
    class: 'item', type: 'button', 'data-key': item.key, 'aria-current': selected ? 'true' : 'false', tabindex: selected ? 0 : -1,
    'aria-label': [row.name, STATUS[row.status].label.replace(/^[!?] /, ''), label(row.reason), row.ports.length ? `ports ${row.ports.join(', ')}` : '', `pid ${row.pid}`, size(row.rss)].filter(Boolean).join(', '),
    onclick: () => { select(item.key); open(); },
    onfocus: () => select(item.key),
  },
  el('span', { class: 'bar', 'aria-hidden': 'true' }),
  el('span', { class: 'name', text: row.name }),
  el('span', { class: 'right', text: right }),
  el('span', { class: 'sub' }, STATUS[row.status].label ? el('b', { class: STATUS[row.status].dot, text: `${STATUS[row.status].label}${GAP}` }) : null, document.createTextNode(processMeta(row))));
}

function rowNode(row) {
  if (row.kind === 'section') return el('h2', { class: 'section' }, document.createTextNode(row.title), row.count === undefined ? null : el('span', { text: String(row.count) }));
  if (row.kind === 'note') return el('p', { class: `note ${row.tone ?? ''}`, text: row.text });
  return itemRow(row);
}

function detailNode(row) {
  const field = (term, value, tone) => (value ? [el('dt', { text: term }), el('dd', { class: tone || undefined, text: value })] : []);
  return el('section', { class: 'detail', 'aria-label': `${row.name} details` },
    el('h2', { tabindex: -1, 'data-focus': 'detail' }, document.createTextNode(`${row.name}  pid ${row.pid}`)),
    el('dl', {},
      ...field('Status', STATUS[row.status].label.replace(/^[!?] /, '') || (row.status === 'protected' ? 'protected' : 'owned'), STATUS[row.status].dot),
      ...field('Why', label(sentence(row.reason))),
      ...field('Tab', label(row.tab)),
      ...field('Task', row.task),
      ...field('Folder', row.cwd),
      ...field('Ports', row.ports.map((port) => `:${port}`).join(' ')),
      ...field('Memory', size(row.rss)),
      ...field('CPU', row.cpu === undefined ? undefined : `${Math.round(row.cpu)}%`),
      ...field('Started', ago(row.startedAt)),
      ...field('Command', row.command)));
}

function asksNodes() {
  if (!ui.waiting) return [el('p', { class: `note ${ui.waitingError ? 'red' : ''}`, text: ui.waitingError ? "Can't reach b1 right now." : 'Reading b1…' }), alertsLine];
  const rows = ui.waiting.map((row) => el('div', { class: 'item' },
    el('span', { class: 'bar', 'aria-hidden': 'true' }),
    el('span', { class: 'name', text: row.tab }),
    el('span', { class: 'right', text: row.place ?? '' }),
    el('span', { class: 'sub', text: [row.message && row.message !== 'Waiting for user' ? row.message : row.kind === 'permission' ? 'Wants approval' : 'Waiting for you', `waiting ${waited(row.since) === 'now' ? 'now' : waited(row.since)}`].join(GAP) })));
  return [
    el('h2', { class: 'section' }, document.createTextNode('Waiting on you'), el('span', { text: String(rows.length) })),
    ...(rows.length ? rows : [el('p', { class: 'note', text: "Nothing is waiting. You'll get an alert when a tab needs you." })]),
    el('p', { class: 'note', text: 'Answer in Rex: open the tab, or use View Activity to find it.' }),
    alertsLine,
  ];
}

const svg = (tag, attributes) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

const niceMax = (peak) => [10, 25, 50, 100].find((step) => peak * 1.2 <= step) ?? 100;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);
const DOT = 2;
const DENSITY = 0.5;
const charts = new Map();

function drawDither(canvas) {
  const { points } = charts.get(canvas) ?? {};
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!points || !width || !height) return;
  const scale = devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  const color = getComputedStyle(canvas).color;
  const tint = (alpha) => color.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`);
  const top = (x) => {
    const at = (x / width) * 100;
    const next = points.findIndex(([px]) => px >= at);
    if (next <= 0) return (points[0][1] / 100) * height;
    const [x0, y0] = points[next - 1], [x1, y1] = points[next];
    return ((y0 + ((at - x0) / (x1 - x0 || 1)) * (y1 - y0)) / 100) * height;
  };
  const fill = context.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, tint(0.12));
  fill.addColorStop(1, tint(0));
  context.beginPath();
  context.moveTo(0, height);
  for (let x = 0; x <= width; x += 1) context.lineTo(x, top(x));
  context.lineTo(width, height);
  context.fillStyle = fill;
  context.fill();
  context.clip();
  for (let x = 0; x < width; x += DOT) {
    const surface = Math.min(top(x), top(x + DOT));
    for (let y = Math.floor(surface / DOT) * DOT; y < height; y += DOT) {
      if (DENSITY <= BAYER[((y / DOT) % 4) * 4 + ((x / DOT) % 4)]) continue;
      context.fillStyle = tint(0.9 * Math.max(0, 1 - (y - surface) / Math.max(DOT, height - surface)) ** 1.5);
      context.fillRect(x, y, DOT, DOT);
    }
  }
}

const drawCharts = () => { for (const canvas of charts.keys()) if (canvas.isConnected) drawDither(canvas); else charts.delete(canvas); };
addEventListener('resize', () => requestAnimationFrame(drawCharts));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(drawCharts));

function chart(values, max, hue) {
  const point = (value, index) => [values.length === 1 ? 100 : (index / (values.length - 1)) * 100, 100 - Math.max(0, Math.min(1, value / max)) * 100];
  const points = values.map(point);
  const dither = el('canvas', { class: 'dither', 'aria-hidden': 'true' });
  dither.style.color = hue;
  charts.set(dither, { points });
  const graph = svg('svg', { class: 'chart', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  graph.append(...[25, 50, 75].map((y) => svg('line', { class: 'grid', x1: 0, x2: 100, y1: y, y2: y, 'vector-effect': 'non-scaling-stroke' })),
    svg('polyline', { class: 'line', points: points.map((pair) => pair.join(',')).join(' '), stroke: hue, 'vector-effect': 'non-scaling-stroke' }));
  const frame = el('div', { class: 'chart-frame' }, dither);
  frame.append(graph);
  return frame;
}

const uptimeText = (seconds) => {
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

function healthNodes() {
  if (ui.view !== 'machine') return [];
  if (!ui.machine) return [el('span', { class: `health-item ${ui.machineError ? 'bad' : ''}` }, el('span', { class: 'dot', 'aria-hidden': 'true' }), document.createTextNode(ui.machineError ? 'b1 unreachable' : 'b1'))];
  const { memory, attention: stale, jobs, uptime } = ui.machine;
  const machineTone = memory.tone === 'red' ? 'bad' : memory.tone === 'yellow' || stale.length ? 'warn' : 'good';
  const machineText = ['b1', uptime ? `up ${uptimeText(uptime)}` : '', machineTone === 'good' ? 'healthy' : stale.length ? `${stale.length} to check` : 'memory tight'].filter(Boolean).join(' ');
  const item = (tone, text, title, when) => el('span', { class: `health-item ${tone}`, title }, el('span', { class: 'dot', 'aria-hidden': 'true' }), document.createTextNode(text), when ? el('span', { class: 'when', text: when }) : null);
  return [
    item(machineTone, machineText),
    ...(jobs === undefined ? [item('warn', "jobs can't be read")] : jobs.map((job) => item(
      job.failed ? 'bad' : job.running ? 'warn' : 'good',
      job.name,
      job.nextAt ? `next run ${clock(job.nextAt)}` : undefined,
      job.failed ? 'failed' : job.running ? 'running' : job.lastAt ? ago(job.lastAt) : 'not run yet'))),
  ];
}

function metric({ name, hue, value, detail, history, max, scale, peak, fraction }) {
  const shown = history?.length && Math.max(...history) > max * 0.01 ? history : undefined;
  const summary = shown ? `${peak(Math.max(...shown))} peak in the last ${shown.length} min` : '';
  const node = el('section', { class: 'metric', 'aria-label': `${name}: ${value}. ${[detail, summary].filter(Boolean).join('. ')}` },
    el('div', { class: 'metric-head', 'aria-hidden': 'true' },
      el('span', { class: 'label', text: name }),
      el('span', { class: 'value', text: value }),
      el('span', { class: 'detail-line', text: detail ?? '' })),
    shown
      ? el('div', { class: 'plot', 'aria-hidden': 'true' }, chart(shown, max, hue), el('span', { class: 'scale top', text: scale }),
        el('div', { class: 'axis' }, el('span', { text: `${shown.length} min ago` }), el('span', { text: `peak ${peak(Math.max(...shown))}` }), el('span', { text: 'now' })))
      : history?.length ? null
      : el('span', { class: 'meter', 'aria-hidden': 'true' }, Object.assign(el('span', { class: 'fill' }), { style: `width: ${Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10}%` })));
  node.style.setProperty('--hue', hue);
  return node;
}

function contextNodes() {
  if (ui.view !== 'machine' || !ui.machine) return [];
  const { cpu, memory, history } = ui.machine;
  const used = memory.total - memory.available;
  const tone = { yellow: 'var(--asks)', red: 'var(--bad)' }[memory.tone];
  const cpuMax = niceMax(Math.max(cpu.busy ?? 0, ...(history?.cpu ?? [0])));
  return [el('div', { class: 'gauges' },
    metric({ name: 'CPU', hue: 'var(--cpu)', value: cpu.busy === undefined ? '' : `${Math.round(cpu.busy)}%`, detail: `load ${cpu.load.map((value) => value.toFixed(1)).join(' ')} on ${cpu.cores} cores`, history: history?.cpu, max: cpuMax, scale: `${cpuMax}%`, peak: (top) => `${Math.round(top)}%`, fraction: (cpu.busy ?? 0) / 100 }),
    metric({ name: 'Memory', hue: tone ?? 'var(--mem)', value: gib(used), detail: `of ${gib(memory.total)}, ${gib(memory.available)} available`, history: history?.available?.map((available) => memory.total - available), max: memory.total, scale: gib(memory.total), peak: gib, fraction: used / memory.total }),
    metric({ name: 'Swap', hue: 'var(--swap)', value: gib(memory.swapUsed), detail: history?.swap?.length && Math.max(...history.swap) <= memory.swapTotal * 0.01 ? `of ${gib(memory.swapTotal)}, unused all hour` : `of ${gib(memory.swapTotal)}`, history: history?.swap, max: memory.swapTotal || 1, scale: gib(memory.swapTotal), peak: gib, fraction: memory.swapTotal ? memory.swapUsed / memory.swapTotal : 0 }))];
}

const KEYS = {
  list: [
    { keys: ['ArrowDown', 'j'], label: '↑↓', name: 'move', hint: true, repeat: true, run: () => move(1) },
    { keys: ['ArrowUp', 'k'], run: () => move(-1), repeat: true },
    { keys: ['Enter'], label: 'enter', name: 'details', pointer: true, when: () => Boolean(selectedItem()), run: () => open() },
    { keys: ['d'], label: 'd', name: 'stop', pointer: true, when: () => stoppable(selectedItem()), run: () => confirmStop() },
    { keys: ['r'], label: 'r', name: 'refresh', run: () => refreshNow() },
    { keys: ['1', '2'], label: '1 2', name: 'views', hint: true, run: (key) => go(key === '1' ? 'asks' : 'machine') },
  ],
  detail: [
    { keys: ['d'], label: 'd', name: 'stop', when: () => stoppable(selectedItem()), run: () => confirmStop() },
    { keys: ['r'], label: 'r', name: 'refresh', run: () => refreshNow() },
    { keys: ['Escape'], label: 'esc', name: 'back', run: () => back() },
  ],
  confirm: [
    { keys: ['Enter'], label: 'enter', name: 'stop it', focus: 'stop', danger: true, when: () => !ui.stopping, run: () => stop() },
    { keys: ['Escape'], label: 'esc', name: 'cancel', when: () => !ui.stopping, run: () => back() },
  ],
};

const keysFor = () => (ui.view === 'machine' ? KEYS[ui.mode] : KEYS.list.filter((entry) => ['r', '1'].includes(entry.keys[0])));

function keyNodes() {
  return keysFor().filter((entry) => entry.label).map((entry) => {
    const content = [el('kbd', { text: entry.label }), document.createTextNode(entry.name)];
    if (entry.hint) return el('span', { class: 'hint', 'aria-hidden': 'true' }, ...content);
    const off = entry.when && !entry.when();
    return el('button', { type: 'button', class: [entry.danger ? 'danger' : '', entry.pointer ? 'pointer-only' : ''].join(' ').trim() || undefined, 'aria-label': `${entry.name} (${entry.label})`, 'aria-disabled': off ? 'true' : undefined, 'data-focus': entry.focus ?? `key-${entry.keys[0]}`, onclick: () => { if (!entry.when || entry.when()) entry.run(entry.keys[0]); } }, ...content);
  });
}

function confirmNodes() {
  const row = ui.confirming;
  return [
    el('p', {}, el('b', { text: `Stop ${row.name} (pid ${row.pid})?` })),
    el('p', { text: `${sentence(STATUS[row.status].label.replace(/^[!?] /, ''))}: ${label(row.reason)}. ${size(row.rss)}. b1 checks it is still the same process, asks it to stop, and kills it only if it ignores that for 6 seconds.` }),
  ];
}

function bodyNodes() {
  if (ui.view === 'asks') return asksNodes();
  if (!ui.machine) return [el('p', { class: `note ${ui.machineError ? 'red' : ''}`, text: ui.machineError ? "Can't reach b1 right now." : 'Reading b1…' })];
  if (ui.mode !== 'list' && ui.detailKey) {
    const row = ui.mode === 'confirm' ? ui.confirming : findProcess(ui.detailKey);
    if (row) return [detailNode(row)];
  }
  const columns = { a: [], b: [] };
  let column = columns.a;
  for (const row of machineRows(ui.machine)) {
    if (row.kind === 'section') column = row.title === 'Needs attention' ? columns.a : columns.b;
    column.push(rowNode(row));
  }
  return Object.entries(columns).map(([name, nodes]) => el('div', { class: `column column-${name}` }, ...nodes));
}

function paint({ focus } = {}) {
  const active = document.activeElement;
  const hadFocus = active && active !== document.body && $('.screen').contains(active);
  const focusTarget = focus ?? (hadFocus ? active.dataset.key ?? active.dataset.focus : undefined);
  for (const link of document.querySelectorAll('.tabs a')) {
    if (link.dataset.view === ui.view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('#count-asks').textContent = ui.waiting?.length ? String(ui.waiting.length) : '';
  $('#count-machine').textContent = ui.machine?.attention.length ? String(ui.machine.attention.length) : '';
  const at = ui.view === 'machine' ? ui.machine?.at : ui.waitingAt;
  $('#meta').textContent = at ? `b1  updated ${clock(at)}` : 'b1';
  $('#context').replaceChildren(...contextNodes());
  $('#body').replaceChildren(...bodyNodes());
  const confirm = $('#confirm');
  confirm.hidden = ui.mode !== 'confirm' || ui.view !== 'machine';
  confirm.replaceChildren(...(confirm.hidden ? [] : confirmNodes()));
  const status = $('#status');
  status.className = `status ${ui.status?.tone ?? ''}`;
  status.textContent = ui.status?.text ?? '';
  $('#keys').replaceChildren(...keyNodes());
  $('#health').replaceChildren(...healthNodes());
  requestAnimationFrame(drawCharts);
  document.title = ui.view === 'machine' ? 'b1 machine' : 'Asks';
  $('.screen').dataset.view = ui.view;
  if (focusTarget) (document.querySelector(`[data-key="${focusTarget}"]`) ?? document.querySelector(`[data-focus="${focusTarget}"]`))?.focus({ preventScroll: false });
}

function say(text, tone) {
  ui.status = text ? { text, tone, at: Date.now() } : undefined;
}

function select(key) {
  if (ui.selected === key) return;
  ui.selected = key;
  for (const button of document.querySelectorAll('button.item')) {
    const current = button.dataset.key === key;
    button.setAttribute('aria-current', String(current));
    button.tabIndex = current ? 0 : -1;
  }
  $('#keys').replaceChildren(...keyNodes());
}

const STATUS_FADE = 5000;
const reading = () => {
  const selection = getSelection();
  return Boolean(selection && !selection.isCollapsed && $('.screen').contains(selection.anchorNode));
};

function fadeStatus() {
  if (ui.status && ui.status.tone !== 'red' && !ui.stopping && Date.now() - ui.status.at > STATUS_FADE) say();
}

function move(step) {
  const list = items();
  if (!list.length) return;
  const index = list.findIndex((item) => item.key === ui.selected);
  ui.selected = list[Math.min(Math.max(index === -1 ? 0 : index + step, 0), list.length - 1)].key;
  paint({ focus: ui.selected });
  document.querySelector(`[data-key="${ui.selected}"]`)?.scrollIntoView({ block: 'nearest' });
}

function open() {
  const item = selectedItem();
  if (!item) return;
  ui.detailKey = processKey(item.process);
  ui.mode = 'detail';
  say();
  paint({ focus: 'detail' });
  scrollTo({ top: 0 });
}

function confirmStop() {
  const item = selectedItem();
  if (!stoppable(item)) return;
  ui.returnMode = ui.mode;
  ui.detailKey = processKey(item.process);
  ui.confirming = item.process;
  ui.mode = 'confirm';
  say();
  paint({ focus: 'stop' });
}

function back() {
  if (ui.mode === 'confirm') {
    ui.mode = ui.returnMode === 'detail' && findProcess(ui.detailKey) ? 'detail' : 'list';
    ui.confirming = undefined;
    say('Cancelled.');
    return paint({ focus: ui.mode === 'detail' ? 'detail' : ui.selected });
  }
  ui.mode = 'list';
  ui.detailKey = undefined;
  say();
  paint({ focus: ui.selected });
}

async function stop() {
  const row = ui.confirming;
  ui.stopping = true;
  say(`Stopping ${row.name} (${row.pid})…`);
  paint({ focus: 'stop' });
  try {
    const answer = await api('/api/machine/stop', { pid: row.pid, start: row.start });
    say(answer.text, answer.ok ? 'green' : 'red');
  } catch {
    say("Couldn't reach b1, so nothing was stopped.", 'red');
  }
  ui.stopping = false;
  ui.confirming = undefined;
  ui.detailKey = undefined;
  ui.mode = 'list';
  await refreshMachine({ focus: 'selected' });
}

function go(view) {
  if (ui.mode === 'confirm') return;
  location.hash = view === 'machine' ? 'machine' : 'asks';
}

function showView() {
  ui.view = location.hash === '#machine' ? 'machine' : 'asks';
  ui.mode = 'list';
  ui.detailKey = undefined;
  ui.confirming = undefined;
  say();
  paint();
  refreshNow();
}

async function refreshMachine({ focus } = {}) {
  if (ui.view !== 'machine' || ui.stopping || ui.mode === 'confirm') return;
  if (focus === 'selected' && !document.querySelector('.screen').contains(document.activeElement)) focus = undefined;
  const previous = items();
  try {
    const next = await api('/api/machine');
    if (!next.cpu) throw new Error(next.text);
    ui.machine = next;
    ui.machineError = false;
    keepSelection(previous);
    if (focus === 'selected') focus = ui.selected ?? 'key-r';
    if (ui.mode === 'detail' && !findProcess(ui.detailKey)) {
      ui.mode = 'list';
      say(`pid ${ui.detailKey.split(':')[0]} has exited or left the lists.`);
      focus = ui.selected;
    }
    if (ui.status?.tone === 'red' && /reach b1/.test(ui.status.text)) say();
  } catch {
    ui.machineError = true;
    if (ui.machine) say(`Can't reach b1 right now. Showing the reading from ${clock(ui.machine.at)}.`, 'red');
  }
  fadeStatus();
  if (!focus && reading()) return;
  paint({ focus });
}

async function refreshAsks() {
  try {
    ui.waiting = (await api('/api/waiting')).waiting;
    ui.waitingAt = Date.now();
    ui.waitingError = false;
  } catch {
    ui.waitingError = true;
  }
  if ('setAppBadge' in navigator && ui.waiting) (ui.waiting.length ? navigator.setAppBadge(ui.waiting.length) : navigator.clearAppBadge()).catch(() => {});
  fadeStatus();
  if (ui.view === 'asks' && !reading()) paint();
}

function refreshNow() {
  refreshAsks();
  refreshMachine();
}

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229) return;
  const control = event.target.closest?.('button, a');
  if (event.key === 'Enter' && control && !control.classList.contains('item')) return;
  if (event.key === 'Enter' && control?.classList.contains('item') && ui.mode === 'list') return;
  const entry = keysFor().find((candidate) => candidate.keys.includes(event.key));
  if (!entry || (entry.when && !entry.when()) || (event.repeat && !entry.repeat)) return;
  event.preventDefault();
  entry.run(event.key);
});

function alerts(text, tone, action) {
  const line = alertsLine;
  line.dataset.tone = tone ?? '';
  line.replaceChildren(el('span', { text }), action ?? null);
}
async function subscribe() {
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/push');
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  const subscription = (await registration.pushManager.getSubscription()) ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const result = await api('/api/push', { subscription: subscription.toJSON() });
  if (!result.ok) throw new Error(result.text);
}
async function sendTest(button) {
  button.disabled = true;
  alerts('Sending a test alert…', '', button);
  try {
    await subscribe();
    const result = await api('/api/push/test', {});
    if (!result.ok) throw new Error(result.text);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const seen = await api('/api/push/seen');
      if (seen.tag === result.tag) {
        alerts(seen.stage === 'shown' ? 'Alerts on. The test reached this phone.' : `iOS refused to show it: ${seen.problem}`, seen.stage === 'shown' ? 'good' : 'bad', button);
        button.disabled = false;
        return;
      }
    }
    alerts(`${result.text} This phone never got it. Check Settings, Notifications, Asks, and any Focus.`, 'bad', button);
  } catch (error) {
    alerts(`Test failed: ${error.message}`, 'bad', button);
  }
  button.disabled = false;
}
async function setupAlerts() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) {
    alerts(standalone ? 'This browser has no push alerts.' : 'For alerts, tap Share, then Add to Home Screen, and open Asks from there.', 'bad');
    return;
  }
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const test = el('button', { class: 'link', type: 'button', text: 'Send test alert', onclick: () => sendTest(test) });
  if (Notification.permission === 'granted') {
    try { await subscribe(); alerts('Alerts on for this phone.', 'good', test); } catch (error) { alerts(`Alerts allowed, but subscribing failed: ${error.message}`, 'bad', test); }
    return;
  }
  if (Notification.permission === 'denied') return alerts('Alerts are blocked. Turn them on in Settings, Notifications, Asks.', 'bad');
  const turnOn = el('button', { class: 'link', type: 'button', text: 'Turn on alerts', onclick: async () => {
    turnOn.disabled = true;
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') {
      turnOn.disabled = false;
      return alerts(answer === 'denied' ? 'iOS said no. Turn alerts on in Settings, Notifications, Asks.' : "iOS didn't ask. Close Asks in the app switcher, reopen it from the Home Screen and try again.", 'bad', turnOn);
    }
    try { await subscribe(); alerts('Alerts on for this phone.', 'good', test); } catch (error) { alerts(`Subscribing failed: ${error.message}`, 'bad', test); }
  } });
  alerts('Alerts are off.', 'bad', turnOn);
}

window.addEventListener('hashchange', showView);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ui.status) ui.status.at = Date.now();
  refreshNow();
});
setInterval(() => { if (document.visibilityState === 'visible') refreshNow(); }, 5000);
showView();
setupAlerts().catch((error) => alerts(error.message, 'bad'));
