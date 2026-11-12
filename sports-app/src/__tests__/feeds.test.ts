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
