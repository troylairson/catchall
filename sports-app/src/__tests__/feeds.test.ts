import { describe, expect, it } from 'vitest';
import nflSummary from './fixtures/espn-nfl-summary.json';
import { parseDrives } from '../feeds/football';

describe('NFL drives', () => {
  it('turns ESPN drives into rows with plays', () => {
    const drives = parseDrives(nflSummary);
    expect(drives).toHaveLength(3);
    expect(drives[0]).toMatchObject({ team: 'CLE', result: 'Fumble', summary: '5 plays, 15 yards, 2:52', current: false });
    expect(drives[0].start).toBe('Q1 15:00 · CLE 27');
    expect(drives[0].plays[0].text).toMatch(/kicks/);
  });

  it('includes the drive in progress', () => {
    const cur = { ...nflSummary.drives.previous[0], id: 'live1', result: undefined, displayResult: undefined };
    const drives = parseDrives({ drives: { previous: nflSummary.drives.previous, current: cur } });
    expect(drives[drives.length - 1]).toMatchObject({ id: 'live1', current: true, result: 'In progress' });
  });
});

import nhlPbp from './fixtures/nhl-pbp.json';
import espnNhlSummary from './fixtures/espn-nhl-summary.json';
import { parseEspnHockey, parseNhlPbp } from '../feeds/hockey';

describe('Penguins events', () => {
  it('reads the NHL play-by-play with player names', () => {
    const f = parseNhlPbp(nhlPbp);
    expect(f.source).toBe('NHL');
    expect(f.shots).toEqual({ away: 33, home: expect.any(Number), awayAbbr: 'PIT', homeAbbr: 'ANA' });
    const goal = f.events.find((e) => e.kind === 'goal')!;
    expect(goal.text).toBe('GOAL — M. Granlund (5), snap shot · Assists: C. Gauthier, J. LaCombe');
    expect(goal).toMatchObject({ period: '1st', clock: '08:26', team: 'ANA', score: '0–1' });
    expect(f.events.find((e) => e.kind === 'penalty')!.text).toMatch(/^Penalty — .+, hooking \(2 min\)$/);
    expect(f.events.some((e) => e.text.includes('stoppage'))).toBe(false);
  });

  it('reads ESPN hockey plays as a fallback', () => {
    const f = parseEspnHockey(espnNhlSummary);
    expect(f.source).toBe('ESPN');
    expect(f.shots).toMatchObject({ away: 33, awayAbbr: 'PIT', homeAbbr: 'ANA' });
    expect(f.events.find((e) => e.kind === 'goal')).toMatchObject({ team: 'ANA', score: '0–1', period: '1st' });
    expect(f.events.find((e) => e.kind === 'penalty')!.text).toMatch(/Tripping .* \(2 min\)$/);
    expect(f.events.find((e) => e.kind === 'shot')!.text).toMatch(/saved by/);
  });
});

import nbaSummary from './fixtures/espn-nba-summary.json';
import { parseNbaPlays, quarterName } from '../feeds/basketball';

describe('Cavaliers plays', () => {
  it('flattens ESPN plays with team, score and quarter', () => {
    const f = parseNbaPlays(nbaSummary);
    expect(f.plays).toHaveLength(15);
    const steal = f.plays.find((p) => p.text.includes('steals'))!;
    expect(steal.text).toBe('Mikal Bridges bad pass turnover (Donovan Mitchell steals)');
    expect(steal.team).toBe('NY');
    expect(f.plays[f.plays.length - 1]).toMatchObject({ text: 'End of Game', score: '115–107', period: 4 });
    expect(Object.keys(f.logos).sort()).toEqual(['CLE', 'NY']);
  });

  it('names overtimes', () => {
    expect([4, 5, 6].map(quarterName)).toEqual(['Q4', 'OT', '2OT']);
  });
});
