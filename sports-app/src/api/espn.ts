import type { Game, GameState, League, Side } from '../types';
import type { TeamConfig } from '../teams';
import { getJson } from './http';

export const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

const num = (s: any): number | undefined => {
  if (s == null) return undefined;
  if (typeof s === 'object') return num(s.value ?? s.displayValue);
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function espnState(type: any): GameState {
  const name: string = type?.name ?? '';
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(name) && type?.state !== 'in') return 'off';
  if (type?.state === 'in') return 'live';
  if (type?.state === 'post') return 'post';
  return 'pre';
}

function logoOf(team: any): string | undefined {
  if (!team) return undefined;
  if (typeof team.logo === 'string') return team.logo;
  const logos: any[] = team.logos ?? [];
  return (logos.find((l) => l.rel?.includes('default')) ?? logos[0])?.href;
}

function side(c: any, includeScore: boolean): Side {
  const t = c.team ?? {};
  const rec = Array.isArray(c.records) ? c.records[0]?.summary : Array.isArray(c.record) ? c.record[0]?.displayValue : undefined;
  return {
    abbr: t.abbreviation ?? '',
    name: t.shortDisplayName ?? t.name ?? t.displayName ?? '',
    logo: logoOf(t),
    score: includeScore ? num(c.score) : undefined,
    record: rec,
  };
}

function broadcastOf(comp: any): string | undefined {
  const b: any[] = comp.broadcasts ?? [];
  const names = b.flatMap((x) => x.names ?? (x.media?.shortName ? [x.media.shortName] : []));
  return names.length ? [...new Set(names)].slice(0, 2).join(', ') : undefined;
}

function liveStatus(league: League, st: any): string {
  const t = st?.type ?? {};
  if (/HALFTIME/.test(t.name ?? '')) return 'Halftime';
  if (/END_PERIOD/.test(t.name ?? '')) return t.shortDetail ?? 'End';
  const p = st?.period ?? 0;
  const clock = st?.displayClock ?? '';
  if (league === 'nhl') {
    const per = p <= 3 ? ['1st', '2nd', '3rd'][p - 1] : p === 4 ? 'OT' : p === 5 ? 'SO' : `${p - 3}OT`;
    return `${per} ${clock}`.trim();
  }
  const q = p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`;
  return `${q} ${clock}`.trim();
}

/** Turn an ESPN event (scoreboard or schedule flavour) into a Game for our team. */
export function espnGame(ev: any, league: League, ourAbbr: string): Game | undefined {
  const comp = ev.competitions?.[0];
  if (!comp) return undefined;
  const cs: any[] = comp.competitors ?? [];
  const homeC = cs.find((c) => c.homeAway === 'home');
  const awayC = cs.find((c) => c.homeAway === 'away');
  if (!homeC || !awayC) return undefined;
  const st = comp.status ?? ev.status ?? {};
  const state = espnState(st.type);
  const withScore = state === 'live' || state === 'post';
  const home = side(homeC, withScore);
  const away = side(awayC, withScore);
  const isHome = home.abbr.toLowerCase() === ourAbbr.toLowerCase();
  if (!isHome && away.abbr.toLowerCase() !== ourAbbr.toLowerCase()) return undefined;

  let status = '';
  if (state === 'post') status = st.type?.shortDetail ?? 'Final';
  else if (state === 'live') status = liveStatus(league, st);
  else if (state === 'off') status = st.type?.description ?? 'Postponed';

  let situation: string | undefined;
  const sit = comp.situation;
  if (state === 'live' && sit) {
    const poss = sit.possession ? cs.find((c) => c.team?.id === sit.possession || c.id === sit.possession)?.team?.abbreviation : undefined;
    const dd = sit.downDistanceText ?? sit.shortDownDistanceText;
    if (dd) situation = `${poss ? `${poss} ball · ` : ''}${dd}${sit.isRedZone ? ' · red zone' : ''}`;
  }

  const headline: string | undefined = comp.notes?.[0]?.headline ?? ev.notes?.[0]?.headline;
  const seasonType = ev.seasonType?.type ?? ev.season?.type;
  const label = headline ?? (seasonType === 1 ? 'Preseason' : seasonType === 3 ? 'Playoffs' : undefined);

  return {
    id: String(ev.id),
    league,
    start: ev.date ?? comp.date,
    timeTBD: comp.timeValid === false ? true : undefined,
    state,
    status,
    situation,
    home,
    away,
    isHome,
    label,
    broadcast: broadcastOf(comp),
  };
}

export interface TeamSchedule {
  games: Game[];
  record?: string;
  standing?: string;
  note?: string;
}

export function parseEspnSchedule(json: any, league: League, abbr: string): TeamSchedule {
  const games = (json.events ?? [])
    .map((e: any) => espnGame(e, league, abbr))
    .filter(Boolean) as Game[];
  return {
    games,
    record: json.team?.recordSummary || undefined,
    standing: json.team?.standingSummary || undefined,
  };
}

export async function espnSchedule(cfg: TeamConfig, now = Date.now()): Promise<TeamSchedule> {
  const e = cfg.espn!;
  const base = `${ESPN}/${e.sport}/${e.league}/teams/${e.abbr}/schedule`;
  const json = await getJson(base);
  const out = parseEspnSchedule(json, cfg.league, e.abbr);
  const hasUpcoming = out.games.some((g) => g.state === 'pre' && Date.parse(g.start) > now);
  // Regular season over: look for playoff games before calling it an offseason.
  if (!hasUpcoming && json.requestedSeason?.type === 2) {
    try {
      const post = parseEspnSchedule(await getJson(`${base}?seasontype=3`), cfg.league, e.abbr);
      out.games = [...out.games, ...post.games.filter((g) => !out.games.some((x) => x.id === g.id))];
    } catch {
      /* no playoff schedule */
    }
  }
  if (!out.games.some((g) => g.state === 'pre' && Date.parse(g.start) > now)) {
    out.note = 'Offseason · next schedule not released yet';
  }
  return out;
}

/** Today's (or this week's) scoreboard, filtered to our team. */
export async function espnLive(cfg: TeamConfig): Promise<Game[]> {
  const e = cfg.espn!;
  const json = await getJson(`${ESPN}/${e.sport}/${e.league}/scoreboard`);
  return (json.events ?? []).map((ev: any) => espnGame(ev, cfg.league, e.abbr)).filter(Boolean) as Game[];
}
