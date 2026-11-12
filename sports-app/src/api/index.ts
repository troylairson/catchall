import type { Game } from '../types';
import type { TeamConfig } from '../teams';
import { espnLive, espnSchedule, type TeamSchedule } from './espn';
import { nhlLive, nhlSchedule } from './nhl';
import { mlbLive, mlbSchedule } from './mlb';
import { nhlBase } from './http';

/** Which feed a team uses right now. Penguins use the NHL API only when it is reachable. */
export function sourceOf(cfg: TeamConfig): 'espn' | 'nhl' | 'mlb' {
  if (cfg.mlb) return 'mlb';
  if (cfg.nhl && nhlBase()) return 'nhl';
  return 'espn';
}

export function loadSchedule(cfg: TeamConfig): Promise<TeamSchedule> {
  switch (sourceOf(cfg)) {
    case 'mlb':
      return mlbSchedule(cfg);
    case 'nhl':
      return nhlSchedule(cfg, nhlBase()!);
    default:
      return espnSchedule(cfg);
  }
}

export function loadLive(cfg: TeamConfig): Promise<Game[]> {
  switch (sourceOf(cfg)) {
    case 'mlb':
      return mlbLive(cfg);
    case 'nhl':
      return nhlLive(cfg, nhlBase()!);
    default:
      return espnLive(cfg);
  }
}
