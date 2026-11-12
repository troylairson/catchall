import type { Game, GameState, Side } from '../types';
import type { TeamConfig } from '../teams';
import { getJson } from './http';
import type { TeamSchedule } from './espn';

const name = (x: any) => (typeof x === 'string' ? x : x?.default ?? '');

export function nhlState(g: any): GameState {
  if (g.gameScheduleState && g.gameScheduleState !== 'OK') return 'off';
  switch (g.gameState) {
    case 'LIVE':
    case 'CRIT':
      return 'live';
    case 'FINAL':
    case 'OFF':
      return 'post';
    default:
      return 'pre';
  }
}

export function periodName(pd: any): string {
  const n = pd?.number ?? 0;
  if (pd?.periodType === 'SO') return 'SO';
  if (pd?.periodType === 'OT') return n > 4 ? `${n - 3}OT` : 'OT';
  return ['1st', '2nd', '3rd'][n - 1] ?? `P${n}`;
}

function side(t: any, withScore: boolean): Side {
  return {
    abbr: t.abbrev,
    name: name(t.commonName) || name(t.name),
    logo: t.logo,
    score: withScore ? t.score : undefined,
  };
}

const LABELS: Record<number, string> = { 1: 'Preseason', 3: 'Playoffs' };

export function nhlGame(g: any, ourAbbr: string): Game | undefined {
  const state = nhlState(g);
  const withScore = state === 'live' || state === 'post';
  const home = side(g.homeTeam, withScore);
  const away = side(g.awayTeam, withScore);
  const isHome = home.abbr === ourAbbr;
  if (!isHome && away.abbr !== ourAbbr) return undefined;
  let status = '';
  if (state === 'post') {
    const t = g.gameOutcome?.lastPeriodType;
    status = t === 'OT' || t === 'SO' ? `Final/${t}` : 'Final';
  } else if (state === 'live') {
    const pd = g.periodDescriptor;
    const clock = g.clock;
    if (clock?.inIntermission) status = `${periodName(pd)} INT`;
    else status = `${periodName(pd)} ${clock?.timeRemaining ?? ''}`.trim();
  } else if (state === 'off') {
    status = g.gameScheduleState === 'CNCL' ? 'Cancelled' : 'Postponed';
  }
  const tv: any[] = g.tvBroadcasts ?? [];
  const national = tv.filter((b) => b.market === 'N' && b.countryCode === 'US');
  const local = tv.filter((b) => (b.market === 'H' && isHome) || (b.market === 'A' && !isHome));
  const broadcast = [...national, ...local].map((b) => b.network).slice(0, 2).join(', ') || undefined;
  return {
    id: String(g.id),
    league: 'nhl',
    start: g.startTimeUTC,
    state,
    status,
    situation: state === 'live' && g.homeTeam?.sog != null ? `Shots ${g.awayTeam.sog}–${g.homeTeam.sog}` : undefined,
    home,
    away,
    isHome,
    label: LABELS[g.gameType],
    broadcast,
  };
}

export async function nhlSchedule(cfg: TeamConfig, base: string, now = Date.now()): Promise<TeamSchedule> {
  const abbr = cfg.nhl!.abbr;
  const json = await getJson(`${base}/v1/club-schedule-season/${abbr}/now`);
  const games = (json.games ?? []).map((g: any) => nhlGame(g, abbr)).filter(Boolean) as Game[];
  const note = games.some((g) => g.state === 'pre' && Date.parse(g.start) > now)
    ? undefined
    : 'Offseason · next schedule not released yet';
  return { games, note };
}

export async function nhlLive(cfg: TeamConfig, base: string): Promise<Game[]> {
  const abbr = cfg.nhl!.abbr;
  const json = await getJson(`${base}/v1/score/now`);
  return (json.games ?? []).map((g: any) => nhlGame(g, abbr)).filter(Boolean) as Game[];
}
