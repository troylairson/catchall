// Round trip: encrypt a notification the way the server does, then decrypt it the way a phone
// would (independent http_ece implementation), and verify the VAPID signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import ece from 'http_ece';
import { buildPushPayload } from '@block65/webcrypto-web-push';

const b64u = (b) => Buffer.from(b).toString('base64url');

test('push payload decrypts on the device and VAPID verifies', async () => {
  // "Phone" side: subscription keys.
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: 'https://web.push.apple.com/QExample',
    expirationTime: null,
    keys: { p256dh: b64u(phone.getPublicKey()), auth: b64u(auth) },
  };

  // Server side: VAPID keys, same format as scripts/vapid-keys.mjs prints.
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = {
    subject: 'mailto:test@example.com',
    publicKey: b64u(await crypto.subtle.exportKey('raw', publicKey)),
    privateKey: (await crypto.subtle.exportKey('jwk', privateKey)).d,
  };

  const msg = { title: '🏈 Steelers score', body: 'PIT 7, CIN 0 · Q1 9:12', tag: 'nfl-pit-1', url: 'https://x/#/game/nfl-pit/1' };
  const req = await buildPushPayload({ data: JSON.stringify(msg), options: { ttl: 900, urgency: 'high', topic: 'nflpit1' } }, subscription, vapid);

  assert.equal(req.method.toUpperCase(), 'POST');
  assert.equal(req.headers['content-encoding'], 'aes128gcm');
  assert.equal(req.headers.urgency, 'high');

  const plain = ece.decrypt(Buffer.from(req.body), { version: 'aes128gcm', privateKey: phone, authSecret: b64u(auth) });
  assert.deepEqual(JSON.parse(plain.toString('utf8').replace(/\0+$/, '')), msg);

  // Authorization: vapid t=<jwt>, k=<public key>
  const [, jwt, k] = req.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [h, p, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, vapid.subject);
  const key = createPublicKey({ key: await crypto.subtle.exportKey('jwk', publicKey), format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});
