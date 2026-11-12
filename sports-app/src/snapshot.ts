import type { Game, TeamSnapshot } from './types';

/** Merge fresher games (from a scoreboard) over schedule games, matched by id. */
export function mergeGames(schedule: Game[], fresh: Game[]): Game[] {
  const byId = new Map(schedule.map((g) => [g.id, g]));
  for (const g of fresh) byId.set(g.id, { ...byId.get(g.id), ...g, label: g.label ?? byId.get(g.id)?.label });
  return [...byId.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Pick the live game, the most recent final and the next scheduled game.
 * A "pre" game whose start time has passed by more than 6h is treated as stale and ignored.
 */
export function snapshotFrom(games: Game[], now = Date.now(), note?: string): TeamSnapshot {
  const sorted = [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const live = sorted.find((g) => g.state === 'live');
  const last = [...sorted].reverse().find((g) => g.state === 'post');
  const next = sorted.find(
    (g) => g.state === 'pre' && g !== live && Date.parse(g.start) > now - 6 * 3600_000,
  );
  return { live, last, next, note, updated: now };
}

/** Did our team win the game? undefined when not final or tied. */
export function result(g: Game): 'W' | 'L' | 'T' | undefined {
  if (g.state !== 'post' || g.home.score == null || g.away.score == null) return undefined;
  const us = g.isHome ? g.home.score : g.away.score;
  const them = g.isHome ? g.away.score : g.home.score;
  return us > them ? 'W' : us < them ? 'L' : 'T';
}

export const opponent = (g: Game) => (g.isHome ? g.away : g.home);
export const us = (g: Game) => (g.isHome ? g.home : g.away);

/** Next poll delay: fast while live or about to start, slow otherwise. */
export function pollDelay(snaps: (TeamSnapshot | undefined)[], now = Date.now()): number {
  const soon = snaps.some((s) => {
    if (!s) return false;
    if (s.live) return true;
    const n = s.next && Date.parse(s.next.start);
    return !!n && n - now < 15 * 60_000 && n - now > -6 * 3600_000;
  });
  return soon ? 20_000 : 5 * 60_000;
}

/** Live first, then teams playing today, then the configured order. */
export function sortTeams<T extends { snap?: TeamSnapshot }>(items: T[], today: (iso: string) => boolean): T[] {
  const rank = (s?: TeamSnapshot) => (s?.live ? 0 : s?.next && today(s.next.start) ? 1 : 2);
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => rank(a.it.snap) - rank(b.it.snap) || a.i - b.i)
    .map((x) => x.it);
}
