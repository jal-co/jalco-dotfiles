import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const unb64u = (text) => Buffer.from(String(text), 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const RECORD_SIZE = 4096;

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

export function encrypt({ uaPublic, authSecret, plaintext, asPrivate, salt = randomBytes(16) }) {
  const receiver = unb64u(uaPublic);
  const auth = unb64u(authSecret);
  if (receiver.length !== 65 || receiver[0] !== 4) throw new Error('Subscription p256dh key is not an uncompressed P-256 point');
  if (auth.length !== 16) throw new Error('Subscription auth secret must be 16 bytes');
  const sender = createECDH('prime256v1');
  if (asPrivate) sender.setPrivateKey(unb64u(asPrivate)); else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiver);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiver, senderPublic]);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const record = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  if (record.length + 16 > RECORD_SIZE) throw new Error('Push payload is too large');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, size, Buffer.from([senderPublic.length]), senderPublic, body]);
}

export function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const publicKey = unb64u(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)) };
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export async function sendPush(subscription, payload, keys, { subject, ttl = 86_400, topic, fetchImpl = fetch } = {}) {
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:') throw new Error('Push endpoints must use https');
  const body = encrypt({ uaPublic: subscription.keys.p256dh, authSecret: subscription.keys.auth, plaintext: JSON.stringify(payload) });
  const headers = {
    Authorization: vapidAuthorization(endpoint.href, keys, subject),
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high',
  };
  if (topic) headers.Topic = topic;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, gone: response.status === 404 || response.status === 410 };
}
