import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Load public/sw.js in a fake service-worker global and capture its handlers. */
function loadSw() {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: any[] = [];
  const navigated: string[] = [];
  const opened: string[] = [];
  const win = { url: 'https://x.github.io/catchall/sports/', navigate: async (u: string) => (navigated.push(u), win), focus: async () => win };
  let windows: any[] = [];
  const self = {
    registration: { scope: 'https://x.github.io/catchall/sports/', showNotification: async (t: string, o: any) => shown.push({ title: t, ...o }) },
    addEventListener: (name: string, fn: any) => (handlers[name] = fn),
    clients: { matchAll: async () => windows, openWindow: async (u: string) => opened.push(u), claim: async () => {} },
    skipWaiting: () => {},
  };
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, caches: {}, fetch, URL });
  const fire = async (name: string, event: any) => {
    let p: Promise<any> | undefined;
    handlers[name]({ ...event, waitUntil: (x: Promise<any>) => (p = x) });
    await p;
  };
  return { fire, shown, navigated, opened, setWindows: (w: any[]) => (windows = w), win };
}

describe('service worker notifications', () => {
  it('shows the pushed alert, one per game', async () => {
    const sw = loadSw();
    const msg = { title: '🏈 Steelers score', body: 'PIT 7, CIN 0', tag: 'nfl-pit-1', url: 'https://x.github.io/catchall/sports/#/game/nfl-pit/1' };
    await sw.fire('push', { data: { json: () => msg, text: () => JSON.stringify(msg) } });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]).toMatchObject({ title: msg.title, body: msg.body, tag: 'nfl-pit-1', renotify: true, data: { url: msg.url } });
  });

  it('opens the game when tapped, reusing an open window', async () => {
    const sw = loadSw();
    const url = 'https://x.github.io/catchall/sports/#/game/nfl-pit/1';
    const n = { close: () => {}, data: { url } };
    await sw.fire('notificationclick', { notification: n });
    expect(sw.opened).toEqual([url]);
    sw.setWindows([sw.win]);
    await sw.fire('notificationclick', { notification: n });
    expect(sw.navigated).toEqual([url]);
  });
});
