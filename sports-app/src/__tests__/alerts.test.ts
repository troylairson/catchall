import { describe, expect, it } from 'vitest';
import { diffGame, memoOf, wanted, DEFAULT_PREFS, type GameMemo } from '../alerts';
import { teamByKey } from '../teams';
import type { Game } from '../types';

const steelers = teamByKey('nfl-pit')!;
const cavs = teamByKey('nba-cle')!;
const START = Date.parse('2026-11-16T01:20:00Z');

const nfl = (state: Game['state'], away?: number, home?: number, status = ''): Game => ({
  id: '401873064',
  league: 'nfl',
  start: '2026-11-16T01:20:00Z',
  state,
  status,
  home: { abbr: 'CIN', name: 'Bengals', score: home },
  away: { abbr: 'PIT', name: 'Steelers', score: away },
  isHome: false,
  broadcast: 'NBC',
});

/** Run a sequence of snapshots through diffGame like the server does. */
function run(team: typeof steelers, games: Game[], now = START + 60_000) {
  let memo: GameMemo | undefined;
  const out: string[] = [];
  for (const g of games) {
    const r = diffGame(team, g, memo, now);
    out.push(...r.alerts.map((a) => `${a.kind}: ${a.title} | ${a.body}`));
    memo = r.memo;
  }
  return out;
}

describe('score alerts', () => {
  it('alerts on kickoff, each score and the final', () => {
    expect(
      run(steelers, [
        nfl('pre'),
        nfl('live', 0, 0, 'Q1 15:00'),
        nfl('live', 7, 0, 'Q1 9:12'),
        nfl('live', 7, 0, 'Q1 8:00'),
        nfl('live', 7, 3, 'Q2 1:10'),
        nfl('post', 27, 6, 'Final'),
      ]),
    ).toEqual([
      'start: 🏈 Steelers @ Bengals is on | Watch on NBC',
      'score: 🏈 Steelers score | PIT 7, CIN 0 · Q1 9:12',
      'score: 🏈 Bengals score | PIT 7, CIN 3 · Q2 1:10',
      'final: 🏈 Final: Steelers win 27–6 | @ Bengals · PIT 27, CIN 6',
    ]);
  });

  it('stays quiet when first seeing a game already in progress', () => {
    expect(run(steelers, [nfl('live', 14, 10, 'Q3 2:00')], START + 2 * 3600_000)).toEqual([]);
  });

  it('still says "game on" if it just started when first seen', () => {
    expect(run(steelers, [nfl('live', 0, 0, 'Q1 13:40')], START + 5 * 60_000)).toHaveLength(1);
  });

  it('notes overtime in the final and handles losses', () => {
    const r = run(steelers, [nfl('live', 20, 20, 'OT 2:00'), nfl('post', 20, 23, 'Final/OT')], START + 4 * 3600_000);
    expect(r).toEqual(['final: 🏈 Final: Steelers lose 20–23 (OT) | @ Bengals · PIT 20, CIN 23']);
  });

  it('only remembers changes worth storing for NBA (halftime, close finish)', () => {
    const g = (state: Game['state'], a: number, h: number, status: string): Game => ({
      id: '1',
      league: 'nba',
      start: '2026-11-14T01:00:00Z',
      state,
      status,
      home: { abbr: 'MIA', name: 'Heat', score: h },
      away: { abbr: 'CLE', name: 'Cavaliers', score: a },
      isHome: false,
    });
    expect(memoOf(g('live', 30, 28, 'Q2 5:00'))).toEqual({ state: 'live' });
    expect(
      run(cavs, [
        g('live', 20, 18, 'Q1 1:00'),
        g('live', 22, 18, 'Q1 0:40'),
        g('live', 55, 50, 'Halftime'),
        g('live', 90, 80, 'Q4 6:00'),
        g('live', 96, 94, 'Q4 3:41'),
        g('live', 98, 96, 'Q4 2:00'),
        g('post', 104, 99, 'Final'),
      ]),
    ).toEqual([
      'half: 🏀 Halftime @ Heat | CLE 55, MIA 50',
      'close: 🏀 Close game @ Heat | CLE 96, MIA 94 · Q4 3:41',
      'final: 🏀 Final: Cavaliers win 104–99 | @ Heat · CLE 104, MIA 99',
    ]);
  });

  it('respects preferences', () => {
    const prefs = { ...DEFAULT_PREFS, score: false };
    expect(['start', 'score', 'final', 'half', 'close'].map((k) => wanted(k as any, prefs))).toEqual([true, false, true, false, false]);
  });

  it('links the notification to the game', () => {
    const r = diffGame(steelers, nfl('live', 0, 0, 'Q1'), { state: 'pre' });
    expect(r.alerts[0]).toMatchObject({ url: '#/game/nfl-pit/401873064', tag: 'nfl-pit-401873064' });
  });
});
