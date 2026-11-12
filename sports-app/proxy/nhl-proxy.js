// Optional Cloudflare Worker that forwards GET requests to https://api-web.nhle.com and adds CORS headers.
// The NHL API sends no Access-Control-Allow-Origin header, so a web page can't call it directly.
//
// Deploy (free tier is plenty):
//   npm create cloudflare@latest nhl-proxy -- --type=hello-world   (pick JavaScript)
//   replace src/index.js with this file, then: npx wrangler deploy
// Paste the resulting https://nhl-proxy.<you>.workers.dev URL into the app's Settings.

const ALLOWED_ORIGINS = ['https://troylairson.github.io', 'http://localhost:5174', 'http://localhost:4173'];
const ALLOWED_PATHS = /^\/v1\/(club-schedule-season|score|gamecenter)\//;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (request.method !== 'GET' || !ALLOWED_PATHS.test(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const upstream = await fetch(`https://api-web.nhle.com${url.pathname}${url.search}`, {
      redirect: 'follow',
      cf: { cacheTtl: 5, cacheEverything: true },
    });
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
