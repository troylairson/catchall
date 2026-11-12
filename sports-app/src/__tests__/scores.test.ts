import { describe, expect, it } from 'vitest';
import nflSchedule from './fixtures/espn-nfl-schedule.json';
import espnNhl from './fixtures/espn-nhl-scoreboard.json';
import nhlScore from './fixtures/nhl-score.json';
import mlbSchedule from './fixtures/mlb-schedule.json';
import { espnGame, parseEspnSchedule } from '../api/espn';
import { nhlGame } from '../api/nhl';
import { mlbSituation, parseMlbSchedule, pickMlbNext } from '../api/mlb';
import { mergeGames, pollDelay, result, snapshotFrom, sortTeams } from '../snapshot';
import { whenLabel } from '../time';
import type { Game } from '../types';

const NOW = Date.parse('2026-11-12T04:00:00Z'); // Wed Nov 11, 11 PM ET

describe('ESPN', () => {
  it('parses a team schedule into last/next games', () => {
    const s = parseEspnSchedule(nflSchedule, 'nfl', 'pit');
    expect(s.record).toBe('6-2');
    expect(s.standing).toBe('1st in AFC North');
    const snap = snapshotFrom(s.games, NOW);
    expect(snap.last?.state).toBe('post');
    expect(result(snap.last!)).toBe('W');
    expect(snap.last?.home.score).toBe(27);
    expect(snap.next?.home.abbr).toBe('CIN');
    expect(snap.next?.isHome).toBe(false);
    expect(snap.next?.broadcast).toBe('NBC');
  });

  it('flags flex games with no set time as TBD', () => {
    const s = parseEspnSchedule(nflSchedule, 'nfl', 'pit');
    const flex = s.games.find((g) => g.id === '401873144')!;
    expect(flex.timeTBD).toBe(true);
    expect(flex.label).toMatch(/Flex/);
    expect(whenLabel(flex.start, new Date(NOW), true)).toBe('Sun, Dec 27 · time TBD');
  });

  it('reads a live hockey game from the scoreboard', () => {
    const g = espnGame(espnNhl.events[0], 'nhl', 'pit')!;
    expect(g.state).toBe('live');
    expect(g.status).toBe('2nd 18:49');
    expect(typeof g.home.score).toBe('number');
  });
});

describe('NHL API', () => {
  it('reads a live game from score/now', () => {
    const g = nhlGame(nhlScore.games[0], 'PIT')!;
    expect(g.state).toBe('live');
    expect(g.status).toBe('2nd 18:43');
    expect(g.situation).toMatch(/^Shots \d+–\d+$/);
  });

  it('marks overtime finals', () => {
    const g = nhlGame({ ...nhlScore.games[0], gameState: 'OFF', gameOutcome: { lastPeriodType: 'SO' } }, 'PIT')!;
    expect(g.status).toBe('Final/SO');
  });
});

describe('MLB', () => {
  const games = parseMlbSchedule(mlbSchedule, 114);

  it('drops the postponed copy of a rescheduled game', () => {
    const copies = games.filter((g) => g.id === '849817');
    expect(copies).toHaveLength(1);
    expect(copies[0].state).toBe('post');
  });

  it('labels postseason games', () => {
    expect(games.find((g) => g.id === '849815')!.label).toBe('ALCS · Game 6');
  });

  it('shows Opening Day in the offseason, with spring training as a note', () => {
    const { next, note } = pickMlbNext(games as any, NOW);
    expect(next?.id).toBe('854131');
    expect(next?.label).toBe('Opening Day');
    expect(next?.timeTBD).toBe(true);
    expect(note).toBe('Spring training starts Fri, Feb 19');
  });

  it('shows spring games once spring training is underway', () => {
    const { next } = pickMlbNext(games as any, Date.parse('2027-02-18T12:00:00Z'));
    expect(next?.id).toBe('868344');
    expect(next?.label).toBe('Spring training');
  });

  it('describes base runners', () => {
    expect(mlbSituation({ outs: 1, offense: { first: {}, third: {} } })).toBe('Runners on 1st & 3rd · 1 out');
    expect(mlbSituation({ outs: 2, offense: { first: {}, second: {}, third: {} } })).toBe('Bases loaded · 2 outs');
    expect(mlbSituation({ outs: 0, offense: {} })).toBe('Bases empty · 0 outs');
  });
});

const g = (id: string, start: string, state: Game['state']): Game => ({
  id,
  league: 'nba',
  start,
  state,
  status: '',
  home: { abbr: 'CLE', name: 'Cavaliers' },
  away: { abbr: 'NYK', name: 'Knicks' },
  isHome: true,
});

describe('snapshot', () => {
  it('lets scoreboard data override the schedule', () => {
    const merged = mergeGames([g('1', '2026-11-12T00:00:00Z', 'pre')], [g('1', '2026-11-12T00:00:00Z', 'live')]);
    expect(snapshotFrom(merged, NOW).live?.id).toBe('1');
  });

  it('ignores scheduled games that are long past', () => {
    const snap = snapshotFrom([g('1', '2026-11-10T00:00:00Z', 'pre'), g('2', '2026-11-14T00:00:00Z', 'pre')], NOW);
    expect(snap.next?.id).toBe('2');
  });

  it('polls fast while live or about to start', () => {
    expect(pollDelay([{ live: g('1', '', 'live'), updated: 0 }], NOW)).toBe(20_000);
    expect(pollDelay([{ next: g('1', new Date(NOW + 10 * 60_000).toISOString(), 'pre'), updated: 0 }], NOW)).toBe(20_000);
    expect(pollDelay([{ next: g('1', new Date(NOW + 86_400_000).toISOString(), 'pre'), updated: 0 }], NOW)).toBe(300_000);
  });

  it('floats live teams to the top, then teams playing today', () => {
    const items = [
      { k: 'a', snap: { updated: 0 } },
      { k: 'b', snap: { next: g('1', '2026-11-12T01:00:00Z', 'pre'), updated: 0 } },
      { k: 'c', snap: { live: g('2', '', 'live'), updated: 0 } },
    ];
    expect(sortTeams(items, (iso) => iso.startsWith('2026-11-12')).map((x) => x.k)).toEqual(['c', 'b', 'a']);
  });
});

describe('time labels (Eastern)', () => {
  const now = new Date('2026-11-12T15:00:00Z'); // Thu 10 AM ET
  it('says Tonight / Tomorrow / weekday', () => {
    expect(whenLabel('2026-11-13T00:00:00Z', now)).toBe('Tonight 7:00 PM ET');
    expect(whenLabel('2026-11-13T18:00:00Z', now)).toBe('Tomorrow 1:00 PM ET');
    expect(whenLabel('2026-11-16T01:20:00Z', now)).toBe('Sun 8:20 PM ET');
  });
});
