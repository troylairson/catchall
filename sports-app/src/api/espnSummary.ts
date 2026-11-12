import type { Game } from '../types';
import type { TeamConfig } from '../teams';
import { ESPN, espnGame } from './espn';
import { getJson } from './http';

/** Fetch an ESPN game summary and the Game header for it. */
export async function espnSummary(team: TeamConfig, gameId: string): Promise<{ game?: Game; json: any }> {
  const e = team.espn!;
  const json = await getJson(`${ESPN}/${e.sport}/${e.league}/summary?event=${gameId}`);
  const comp = json.header?.competitions?.[0];
  const game = comp ? espnGame({ id: gameId, date: comp.date, competitions: [comp] }, team.league, e.abbr) : undefined;
  return { game, json };
}

/** Map ESPN team id → { abbr, logo } from a summary. */
export function teamIndex(json: any): Record<string, { abbr: string; logo?: string; name: string }> {
  const out: Record<string, { abbr: string; logo?: string; name: string }> = {};
  for (const c of json.header?.competitions?.[0]?.competitors ?? []) {
    const t = c.team ?? {};
    out[String(t.id ?? c.id)] = {
      abbr: t.abbreviation,
      name: t.shortDisplayName ?? t.name ?? t.displayName,
      logo: t.logo ?? t.logos?.[0]?.href,
    };
  }
  return out;
}
