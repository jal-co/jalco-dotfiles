import assert from 'node:assert/strict';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { test } from 'node:test';
import { encrypt, generateVapidKeys, sendPush, vapidAuthorization } from '../src/webpush.mjs';

const join = (...parts) => parts.join('').replace(/\s+/g, '');

test('encryption matches the RFC 8291 worked example byte for byte', () => {
  const body = encrypt({
    plaintext: Buffer.from('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', 'base64url'),
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPublic: join('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx', 'aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
    authSecret: Buffer.from([0x05, 0x30, 0x59, 0x32, 0xa1, 0xc7, 0xea, 0xbe, 0x13, 0xb6, 0xce, 0xc9, 0xfd, 0xa4, 0x88, 0x82]).toString('base64url'),
    salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
  });
  const header = join('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml', 'mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8');
  const ciphertext = join('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs', 'bI_0LpXMuGvnzQ');
  assert.equal(body.subarray(0, 86).toString('base64url'), header);
  assert.equal(body.subarray(86).toString('base64url'), ciphertext);
});

test('the VAPID token is an ES256 JWT for the push service origin, verifiable with the public key', () => {
  const keys = generateVapidKeys();
  const value = vapidAuthorization('https://web.push.apple.com/QF2x/abc', keys, 'mailto:me@example.com', 1_000_000);
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(value);
  assert.equal(key, keys.publicKey);
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { aud: 'https://web.push.apple.com', exp: 1000 + 12 * 3600, sub: 'mailto:me@example.com' });
  const point = Buffer.from(keys.publicKey, 'base64url');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('a push posts the encrypted body with the required headers, and a gone subscription is reported', async () => {
  const receiver = generateVapidKeys();
  const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: receiver.publicKey, auth: randomBytes(16).toString('base64url') } };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { status: calls.length === 1 ? 201 : 410 }; };
  assert.deepEqual(await sendPush(subscription, { title: 'fix needs you' }, generateVapidKeys(), { subject: 'mailto:me@example.com', fetchImpl }), { status: 201, gone: false });
  assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(calls[0].init.headers.TTL, '86400');
  assert.match(calls[0].init.headers.Authorization, /^vapid t=/);
  assert.equal(calls[0].init.body.readUInt32BE(16), 4096);
  assert.equal((await sendPush(subscription, {}, generateVapidKeys(), { subject: 'mailto:me@example.com', fetchImpl })).gone, true);
  await assert.rejects(sendPush({ ...subscription, endpoint: 'http://push.example' }, {}, generateVapidKeys(), { fetchImpl }), /https/);
});
