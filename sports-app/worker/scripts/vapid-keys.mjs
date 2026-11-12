// Generates a VAPID key pair for Web Push (P-256), printed as base64url.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const raw = await crypto.subtle.exportKey('raw', publicKey);
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY  (paste into wrangler.toml [vars]):\n${b64u(raw)}\n`);
console.log(`VAPID_PRIVATE_KEY (run: npx wrangler secret put VAPID_PRIVATE_KEY, then paste):\n${jwk.d}`);
