// Builds src/catalog.json: every NFL, NBA, NHL and MLB team with the ids each data source needs,
// plus colors and logos. Run with `npm run catalog` when teams change (relocations, renames).
import { writeFileSync } from 'node:fs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
};

// ESPN abbreviation -> NHL api-web / MLB statsapi abbreviation, where they differ.
const NHL_ABBR = { LA: 'LAK', NJ: 'NJD', SJ: 'SJS', TB: 'TBL', UTAH: 'UTA' };
const MLB_ABBR = { ARI: 'AZ', CHW: 'CWS' };

const LEAGUES = [
  { league: 'nfl', sport: 'football' },
  { league: 'nba', sport: 'basketball' },
  { league: 'nhl', sport: 'hockey' },
  { league: 'mlb', sport: 'baseball' },
];

const mlbIds = Object.fromEntries(
  (await get('https://statsapi.mlb.com/api/v1/teams?sportId=1')).teams.map((t) => [t.abbreviation, t.id]),
);

const out = [];
for (const { league, sport } of LEAGUES) {
  const json = await get(`${ESPN}/${sport}/${league}/teams`);
  for (const { team: t } of json.sports[0].leagues[0].teams) {
    const logo = (rel) => t.logos?.find((l) => rel.every((r) => l.rel.includes(r)) && l.rel.length === rel.length)?.href;
    const abbr = t.abbreviation;
    const entry = {
      key: `${league}-${abbr.toLowerCase()}`,
      league,
      name: t.displayName,
      short: t.shortDisplayName,
      abbr,
      espn: { sport, league, abbr: abbr.toLowerCase() },
      primary: `#${t.color ?? '444444'}`,
      secondary: `#${t.alternateColor ?? '888888'}`,
      logo: logo(['full', 'default']),
      logoDark: logo(['full', 'dark']),
    };
    if (league === 'nhl') entry.nhl = { abbr: NHL_ABBR[abbr] ?? abbr };
    if (league === 'mlb') {
      const id = mlbIds[MLB_ABBR[abbr] ?? abbr];
      if (!id) throw new Error(`No MLB id for ${abbr}`);
      entry.mlb = { teamId: id };
      delete entry.espn;
    }
    out.push(entry);
  }
}
out.sort((a, b) => a.league.localeCompare(b.league) || a.name.localeCompare(b.name));
writeFileSync(new URL('../src/catalog.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${out.length} teams`);
