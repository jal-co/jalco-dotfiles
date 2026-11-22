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
  return `${Math.floor(minutes / 60)}h`;
};

async function refresh() {
  let data;
  try { data = await api('/api/waiting'); } catch { $('#summary').textContent = "Can't reach b1 right now."; return; }
  const { waiting } = data;
  $('#summary').textContent = waiting.length ? `${waiting.length} tab${waiting.length === 1 ? '' : 's'} waiting on you` : '';
  if ('setAppBadge' in navigator) (waiting.length ? navigator.setAppBadge(waiting.length) : navigator.clearAppBadge()).catch(() => {});
  if (!waiting.length) {
    $('#list').replaceChildren(el('div', { class: 'empty' }, el('strong', { text: 'Nothing is waiting' }), el('span', { text: "You'll get an alert when a tab needs you." })));
    return;
  }
  $('#list').replaceChildren(el('div', { class: 'group' }, ...waiting.map((row) => el('div', { class: 'row' },
    el('span', { class: 'dot', 'aria-hidden': 'true' }),
    el('span', { class: 'name', text: row.tab }),
    el('span', { class: 'since', text: waited(row.since) }),
    el('span', { class: 'what' }, row.place ? el('b', { text: `${row.place}: ` }) : null, document.createTextNode(row.message && row.message !== 'Waiting for user' ? row.message : row.kind === 'permission' ? 'Wants approval' : 'Waiting for you'))))));
}

function alerts(text, tone, action) {
  const line = $('#alerts');
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

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5000);
refresh();
setupAlerts().catch((error) => alerts(error.message, 'bad'));
