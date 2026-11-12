// Generates a VAPID key pair for Web Push (P-256), as base64url.
//   npm run vapid            human-readable
//   npm run vapid -- --env   VAPID_PUBLIC_KEY=... / VAPID_PRIVATE_KEY=... lines, for `source`
// Generate once and keep the pair: a new pair invalidates every existing subscription.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
const priv = (await crypto.subtle.exportKey('jwk', privateKey)).d;
if (process.argv.includes('--env')) {
  console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${priv}`);
} else {
  console.log(`VAPID_PUBLIC_KEY:\n${pub}\n\nVAPID_PRIVATE_KEY:\n${priv}`);
  console.log('\nStore both with: npx wrangler secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
}
