import type { League } from './types';

export interface TeamConfig {
  key: string; // used in URLs
  league: League;
  name: string;
  short: string;
  abbr: string; // display abbreviation
  /** Source identifiers. */
  espn?: { sport: string; league: string; abbr: string };
  nhl?: { abbr: string };
  mlb?: { teamId: number };
  primary: string;
  secondary: string;
  logo: string;
  logoDark?: string;
}

export const TEAMS: TeamConfig[] = [
  {
    key: 'steelers',
    league: 'nfl',
    name: 'Pittsburgh Steelers',
    short: 'Steelers',
    abbr: 'PIT',
    espn: { sport: 'football', league: 'nfl', abbr: 'pit' },
    primary: '#FFB612',
    secondary: '#101820',
    logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png',
    logoDark: 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/pit.png',
  },
  {
    key: 'penguins',
    league: 'nhl',
    name: 'Pittsburgh Penguins',
    short: 'Penguins',
    abbr: 'PIT',
    nhl: { abbr: 'PIT' },
    // ESPN carries the NHL too and allows browser requests; used when no NHL proxy is set.
    espn: { sport: 'hockey', league: 'nhl', abbr: 'pit' },
    primary: '#FCB514',
    secondary: '#000000',
    logo: 'https://assets.nhle.com/logos/nhl/svg/PIT_light.svg',
    logoDark: 'https://assets.nhle.com/logos/nhl/svg/PIT_dark.svg',
  },
  {
    key: 'cavaliers',
    league: 'nba',
    name: 'Cleveland Cavaliers',
    short: 'Cavaliers',
    abbr: 'CLE',
    espn: { sport: 'basketball', league: 'nba', abbr: 'cle' },
    primary: '#860038',
    secondary: '#FDBB30',
    logo: 'https://a.espncdn.com/i/teamlogos/nba/500/cle.png',
    logoDark: 'https://a.espncdn.com/i/teamlogos/nba/500-dark/cle.png',
  },
  {
    key: 'guardians',
    league: 'mlb',
    name: 'Cleveland Guardians',
    short: 'Guardians',
    abbr: 'CLE',
    mlb: { teamId: 114 },
    primary: '#00385D',
    secondary: '#E50022',
    logo: 'https://www.mlbstatic.com/team-logos/team-cap-on-light/114.svg',
    logoDark: 'https://www.mlbstatic.com/team-logos/team-cap-on-dark/114.svg',
  },
];

export const teamByKey = (key: string) => TEAMS.find((t) => t.key === key);
