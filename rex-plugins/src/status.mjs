import assert from 'node:assert/strict';

export function programStatus({ state, id = 'rex-task', app = 'rex-plugins', title, message, kind, progress }) {
  assert.ok(['idle', 'working', 'done', 'blocked', 'error', 'clear'].includes(state), 'Invalid status');
  assert.ok(id.length <= 128 && id.split('/').length <= 8 && id.split('/').every((part) => /^[A-Za-z0-9_.+-]{1,32}$/.test(part)), 'Invalid status ID');
  assert.match(app, /^[A-Za-z0-9_.+-]{1,32}$/, 'Invalid app ID');
  const fields = [`state=${state}`, `id=${id}`, `app=${app}`];
  for (const [key, value, limit] of [['title', title, 192], ['msg', message, 2048]]) {
    if (value === undefined) continue;
    assert.ok(typeof value === 'string' && !/[\p{Cc}\p{Cf}]/u.test(value) && Buffer.byteLength(value) <= limit, `Invalid ${key}`);
    fields.push(`${key}=${Buffer.from(value).toString('base64')}`);
  }
  if (kind !== undefined) {
    assert.ok(state === 'blocked' && ['permission', 'question', 'auth'].includes(kind), 'Invalid blocked kind');
    fields.push(`kind=${kind}`);
  }
  if (progress !== undefined) {
    assert.ok(['working', 'blocked'].includes(state) && Number.isInteger(progress) && progress >= 0 && progress <= 100, 'Invalid progress');
    fields.push(`progress=${progress}`);
  }
  return `\x1b]7501;${fields.join(':')}\x1b\\`;
}
