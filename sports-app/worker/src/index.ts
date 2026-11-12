// Scores server.
//  - /v1/...            NHL api-web proxy with CORS (the NHL API sends no CORS headers)
//  - /api/vapid         public key the app subscribes with
//  - /api/subscribe     save a push subscription + its teams and alert preferences
//  - /api/unsubscribe   forget a subscription
//  - /api/test          send a test notification
//  - /api/status        subscriber count, teams watched, last check
// A single Durable Object ("hub") stores subscriptions and what it last saw of each game, and checks
// the feeds every minute while a watched game is live or about to start (every 10 minutes otherwise).

import { DurableObject } from 'cloudflare:workers';
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';
import { teamByKey, type TeamConfig } from '../../src/teams';
import { espnLive } from '../../src/api/espn';
import { nhlLive } from '../../src/api/nhl';
import { mlbLive } from '../../src/api/mlb';
import { withSharedRequests } from '../../src/api/http';
import { DEFAULT_PREFS, diffGame, wanted, type Alert, type GameMemo, type Prefs } from '../../src/alerts';
import type { Game } from '../../src/types';

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ALLOWED_ORIGINS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

interface Sub {
  subscription: PushSubscription;
  teams: string[];
  prefs: Prefs;
  app: string; // app URL the notification opens, e.g. https://troylairson.github.io/catchall/sports/
  created: number;
}

const NHL = 'https://api-web.nhle.com';
const NHL_PATHS = /^\/v1\/(club-schedule-season|score|gamecenter|standings)\//;
const MAX_SUBS = 25;
const MAX_TEAMS = 40;

function cors(req: Request, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

const json = (data: unknown, headers: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const url = new URL(req.url);

    if (req.method === 'GET' && NHL_PATHS.test(url.pathname)) {
      const up = await fetch(`${NHL}${url.pathname}${url.search}`, { redirect: 'follow', cf: { cacheTtl: 5, cacheEverything: true } });
      const res = new Response(up.body, up);
      for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
      return res;
    }

    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, h);
      // Writes only from the app's own pages.
      if (req.method === 'POST' && !env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(req.headers.get('Origin') ?? '')) {
        return json({ error: 'origin not allowed' }, h, 403);
      }
      const hub = env.HUB.get(env.HUB.idFromName('hub'));
      const res = await hub.fetch(req);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
      return out;
    }

    return new Response('Scores server', { headers: h });
  },

  async scheduled(_e: ScheduledController, env: Env) {
    await env.HUB.get(env.HUB.idFromName('hub')).kick();
  },
};

async function subId(endpoint: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Hub extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const subs = ((await this.ctx.storage.get<Record<string, Sub>>('subs')) ?? {}) as Record<string, Sub>;
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as any) : {};

    switch (url.pathname) {
      case '/api/subscribe': {
        const s = body.subscription as PushSubscription;
        if (!s?.endpoint?.startsWith('https://') || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'bad subscription' }, {}, 400);
        const id = await subId(s.endpoint);
        if (!subs[id] && Object.keys(subs).length >= MAX_SUBS) return json({ error: 'too many subscriptions' }, {}, 429);
        const teams = (Array.isArray(body.teams) ? body.teams : []).filter((k: string) => teamByKey(k)).slice(0, MAX_TEAMS);
        subs[id] = {
          subscription: { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          teams,
          prefs: { ...DEFAULT_PREFS, ...(body.prefs ?? {}) },
          app: typeof body.app === 'string' && /^https?:\/\//.test(body.app) ? body.app.split('#')[0] : '',
          created: subs[id]?.created ?? Date.now(),
        };
        await this.ctx.storage.put('subs', subs);
        await this.kick();
        return json({ id, teams }, {});
      }
      case '/api/unsubscribe': {
        const id = await subId(String(body.endpoint ?? ''));
        delete subs[id];
        await this.ctx.storage.put('subs', subs);
        return json({ ok: true }, {});
      }
      case '/api/test': {
        const id = await subId(String(body.endpoint ?? ''));
        const sub = subs[id];
        if (!sub) return json({ error: 'not subscribed' }, {}, 404);
        const ok = await this.send(id, sub, {
          kind: 'start',
          title: 'Scores notifications are on',
          body: `Watching ${sub.teams.length} team${sub.teams.length === 1 ? '' : 's'}.`,
          tag: 'test',
          url: '',
        });
        return json({ ok }, {}, ok ? 200 : 502);
      }
      case '/api/status': {
        const teams = [...new Set(Object.values(subs).flatMap((s) => s.teams))];
        return json(
          { subscribers: Object.keys(subs).length, teams, lastCheck: (await this.ctx.storage.get('lastCheck')) ?? null, nextCheck: await this.ctx.storage.getAlarm() },
          {},
        );
      }
    }
    return json({ error: 'not found' }, {}, 404);
  }

  /** Make sure the checker is scheduled. */
  async kick() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    const subs = ((await this.ctx.storage.get<Record<string, Sub>>('subs')) ?? {}) as Record<string, Sub>;
    if (!Object.keys(subs).length) return; // nobody to notify: stop until the next subscribe
    let soon = false;
    try {
      soon = await this.check(subs);
    } finally {
      await this.ctx.storage.put('lastCheck', Date.now());
      await this.ctx.storage.setAlarm(Date.now() + (soon ? 60_000 : 10 * 60_000));
    }
  }

  /** Returns true when a watched game is live or starts within 20 minutes. */
  async check(subs: Record<string, Sub>): Promise<boolean> {
    const keys = [...new Set(Object.values(subs).flatMap((s) => s.teams))];
    const teams = keys.map((k) => teamByKey(k)).filter(Boolean) as TeamConfig[];
    const memos = ((await this.ctx.storage.get<Record<string, GameMemo>>('memos')) ?? {}) as Record<string, GameMemo>;
    const now = Date.now();
    let soon = false;
    let dirty = false;
    const outbox: { team: string; alert: Alert }[] = [];

    await withSharedRequests(async () => {
      const results = await Promise.allSettled(teams.map((t) => liveGames(t)));
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const team = teams[i];
        for (const g of r.value) {
          const start = Date.parse(g.start);
          if (g.state === 'live' || (g.state === 'pre' && start - now < 20 * 60_000 && start - now > -3 * 3600_000)) soon = true;
          const key = `${team.key}:${g.id}`;
          const stored = memos[key] as (GameMemo & { seen?: number }) | undefined;
          const { seen: _seen, ...prev } = stored ?? ({} as { seen?: number });
          const { alerts, memo, changed } = diffGame(team, g, stored ? (prev as GameMemo) : undefined, now);
          if (changed) {
            memos[key] = { ...memo, seen: now } as GameMemo;
            dirty = true;
          }
          for (const alert of alerts) outbox.push({ team: team.key, alert });
        }
      });
    });

    if (dirty) {
      // Forget games not touched for 3 days.
      for (const [k, m] of Object.entries(memos)) if (((m as any).seen ?? 0) < now - 3 * 86_400_000) delete memos[k];
      await this.ctx.storage.put('memos', memos);
    }

    for (const { team, alert } of outbox) {
      for (const [id, sub] of Object.entries(subs)) {
        if (sub.teams.includes(team) && wanted(alert.kind, sub.prefs)) await this.send(id, sub, alert);
      }
    }
    return soon;
  }

  async send(id: string, sub: Sub, alert: Alert): Promise<boolean> {
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({ title: alert.title, body: alert.body, tag: alert.tag, url: `${sub.app}${alert.url}` }),
        options: { ttl: 15 * 60, urgency: 'high', topic: alert.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
      },
      sub.subscription,
      { subject: this.env.VAPID_SUBJECT, publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY },
    );
    let res: Response;
    try {
      res = await fetch(sub.subscription.endpoint, payload);
    } catch (e) {
      console.error(`push to ${id} failed`, e); // network error: try again on the next alert
      return false;
    }
    if (res.status === 404 || res.status === 410) {
      // The phone unsubscribed or the app was removed: drop it.
      const subs = ((await this.ctx.storage.get<Record<string, Sub>>('subs')) ?? {}) as Record<string, Sub>;
      delete subs[id];
      await this.ctx.storage.put('subs', subs);
    }
    return res.ok;
  }
}

/** Today's games for a team, from the same feeds the app uses (NHL from its own API). */
function liveGames(t: TeamConfig): Promise<Game[]> {
  if (t.mlb) return mlbLive(t);
  if (t.nhl) return nhlLive(t, NHL);
  return espnLive(t);
}
