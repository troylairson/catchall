import type { Game, GameState, Side } from '../types';
import type { TeamConfig } from '../teams';
import { getJson } from './http';
import type { TeamSchedule } from './espn';
import { addDays, easternDay, longDate } from '../time';

export const MLB = 'https://statsapi.mlb.com';

const logo = (id: number) => `https://www.mlbstatic.com/team-logos/${id}.svg`;

export function mlbState(status: any): GameState {
  const d: string = status?.detailedState ?? '';
  if (/Postponed|Cancelled|Suspended/.test(d)) return 'off';
  switch (status?.abstractGameState) {
    case 'Live':
      return /Warmup|Pre-Game|Delayed Start/.test(d) ? 'pre' : 'live';
    case 'Final':
      return 'post';
    default:
      return 'pre';
  }
}

const ROUND: Record<string, string> = {
  F: 'Wild Card',
  D: 'Division Series',
  L: 'LCS',
  W: 'World Series',
  S: 'Spring training',
  E: 'Exhibition',
  A: 'All-Star Game',
};

function side(t: any, withScore: boolean): Side {
  return {
    abbr: t.team?.abbreviation ?? '',
    name: t.team?.teamName ?? t.team?.name ?? '',
    logo: logo(t.team?.id),
    score: withScore ? t.score : undefined,
    record: t.leagueRecord ? `${t.leagueRecord.wins}-${t.leagueRecord.losses}` : undefined,
  };
}

function ordinalBase(n: number) {
  return ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`;
}

/** "Runners on 1st & 3rd · 2 outs" from a linescore. */
export function mlbSituation(ls: any): string | undefined {
  if (!ls) return undefined;
  const o = ls.offense ?? {};
  const on = [o.first && 1, o.second && 2, o.third && 3].filter(Boolean) as number[];
  const outs = ls.outs ?? 0;
  const runners =
    on.length === 3 ? 'Bases loaded' : on.length ? `${on.length > 1 ? 'Runners' : 'Runner'} on ${on.map(ordinalBase).join(' & ')}` : 'Bases empty';
  return `${runners} · ${outs} out${outs === 1 ? '' : 's'}`;
}

export function mlbGame(g: any, teamId: number): Game | undefined {
  const isHome = g.teams?.home?.team?.id === teamId;
  if (!isHome && g.teams?.away?.team?.id !== teamId) return undefined;
  const state = mlbState(g.status);
  const withScore = state === 'live' || state === 'post';
  const ls = g.linescore;
  let status = '';
  if (state === 'post') {
    const inn = ls?.currentInning ?? 9;
    status = inn > (ls?.scheduledInnings ?? 9) ? `Final/${inn}` : 'Final';
  } else if (state === 'live') {
    status = ls ? `${ls.inningState ?? ls.inningHalf ?? ''} ${ls.currentInningOrdinal ?? ''}`.trim() : 'In progress';
    if (g.status?.detailedState && /Delay/.test(g.status.detailedState)) status += ' · Delay';
  } else if (state === 'off') status = g.status?.detailedState ?? 'Postponed';

  let label = ROUND[g.gameType];
  if (label === 'LCS') label = g.teams?.home?.team?.league?.id === 104 ? 'NLCS' : 'ALCS';
  if (label && !['S', 'E', 'A'].includes(g.gameType) && g.seriesGameNumber) label += ` · Game ${g.seriesGameNumber}`;
  if (g.doubleHeader && g.doubleHeader !== 'N') label = [label, `Game ${g.gameNumber} of doubleheader`].filter(Boolean).join(' · ');

  const tv: any[] = (g.broadcasts ?? []).filter((b: any) => b.type === 'TV' && (b.isNational || b.homeAway === (isHome ? 'home' : 'away')));
  return {
    id: String(g.gamePk),
    league: 'mlb',
    start: g.gameDate,
    timeTBD: g.status?.startTimeTBD || undefined,
    state,
    status,
    situation: state === 'live' && !/Middle|End/.test(ls?.inningState ?? '') ? mlbSituation(ls) : undefined,
    home: side(g.teams.home, withScore),
    away: side(g.teams.away, withScore),
    isHome,
    label,
    broadcast: [...new Set(tv.map((b) => b.name))].slice(0, 2).join(', ') || undefined,
    // carried for Opening Day detection
    ...({ gameType: g.gameType, season: g.season } as any),
  };
}

type MlbGame = Game & { gameType?: string; season?: string };

/**
 * Choose the "next" game. Outside spring training we skip exhibition games so the card reads
 * "Opening Day" in winter; once spring training is underway, spring games count.
 */
export function pickMlbNext(games: MlbGame[], now: number): { next?: MlbGame; note?: string } {
  const upcoming = games.filter((g) => g.state === 'pre' && Date.parse(g.start) > now - 6 * 3600_000);
  const recent = games.filter((g) => g.state === 'post' && Date.parse(g.start) > now - 4 * 86_400_000);
  const inSpring =
    recent.some((g) => g.gameType === 'S') || (upcoming[0]?.gameType === 'S' && Date.parse(upcoming[0].start) - now < 4 * 86_400_000);
  if (inSpring) return { next: upcoming[0] };
  const real = upcoming.find((g) => g.gameType !== 'S' && g.gameType !== 'E');
  const firstSpring = upcoming.find((g) => g.gameType === 'S');
  let note: string | undefined;
  if (firstSpring && real && Date.parse(firstSpring.start) < Date.parse(real.start)) {
    note = `Spring training starts ${longDate(firstSpring.start)}`;
  }
  if (real && real.gameType === 'R') {
    const earlierReg = games.some(
      (g) => g.gameType === 'R' && g.season === real.season && Date.parse(g.start) < Date.parse(real.start) && g.state !== 'off',
    );
    if (!earlierReg) real.label = 'Opening Day';
  }
  return { next: real ?? upcoming[0], note: real || upcoming[0] ? note : 'Offseason · next schedule not released yet' };
}

const FIELDS =
  'dates,games,gamePk,gameType,season,gameDate,status,abstractGameState,detailedState,startTimeTBD,teams,away,home,team,id,name,abbreviation,teamName,league,score,leagueRecord,wins,losses,seriesGameNumber,doubleHeader,gameNumber,broadcasts,type,isNational,homeAway,linescore,currentInning,currentInningOrdinal,inningState,inningHalf,scheduledInnings,outs,offense,first,second,third';

function scheduleUrl(teamId: number, start: string, end: string, linescore = false) {
  return (
    `${MLB}/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}` +
    `&hydrate=team,broadcasts${linescore ? ',linescore' : ''}&fields=${FIELDS}`
  );
}

export function parseMlbSchedule(json: any, teamId: number): MlbGame[] {
  const out: MlbGame[] = [];
  for (const d of json.dates ?? []) for (const g of d.games ?? []) {
    const game = mlbGame(g, teamId);
    // A postponed game shows up twice (original date + makeup) with the same gamePk.
    if (game) {
      const i = out.findIndex((x) => x.id === game.id);
      if (i >= 0 && out[i].state === 'off') out.splice(i, 1);
      else if (i >= 0 && game.state === 'off') continue;
      out.push(game);
    }
  }
  return out;
}

export async function mlbSchedule(cfg: TeamConfig, now = Date.now()): Promise<TeamSchedule> {
  const id = cfg.mlb!.teamId;
  const today = easternDay(now);
  const json = await getJson(scheduleUrl(id, addDays(today, -200), addDays(today, 200)));
  const games = parseMlbSchedule(json, id);
  const { next, note } = pickMlbNext(games, now);
  // Keep every final/live game, plus only the chosen next game among upcoming ones.
  const kept = games.filter((g) => g.state !== 'pre' || g === next);
  // Postseason games carry the series record, so take the record from the last regular-season game.
  const last = [...games].reverse().find((g) => g.state === 'post' && g.gameType === 'R');
  return { games: kept, note, record: last && (last.isHome ? last.home.record : last.away.record) };
}

export async function mlbLive(cfg: TeamConfig, now = Date.now()): Promise<Game[]> {
  const id = cfg.mlb!.teamId;
  const today = easternDay(now);
  const json = await getJson(scheduleUrl(id, addDays(today, -1), today, true));
  return parseMlbSchedule(json, id).filter((g) => g.state !== 'pre');
}
