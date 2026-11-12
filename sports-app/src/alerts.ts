import type { Game } from './types';
import type { TeamConfig } from './teams';

/** What the server remembers about a game between checks. Kept small: only written when it changes. */
export interface GameMemo {
  state: Game['state'];
  away?: number;
  home?: number;
  half?: boolean; // NBA: halftime alert sent
  close?: boolean; // NBA: close-game alert sent
}

export type AlertKind = 'start' | 'score' | 'final' | 'half' | 'close';

export interface Prefs {
  start: boolean;
  score: boolean; // every score (NBA: halftime and close games instead)
  final: boolean;
}

export const DEFAULT_PREFS: Prefs = { start: true, score: true, final: true };

export interface Alert {
  kind: AlertKind;
  title: string;
  body: string;
  tag: string; // one notification per game: newer replaces older on the lock screen
  url: string; // relative app route
}

const EMOJI: Record<string, string> = { nfl: '🏈', nhl: '🏒', nba: '🏀', mlb: '⚾' };

/** "Q4 3:41" -> minutes left in regulation-or-OT period; undefined when unknown. */
function nbaLate(status: string): boolean {
  const m = status.match(/^(Q4|OT|\d+OT)\s+(\d+):(\d+)/);
  if (!m) return false;
  return Number(m[2]) < 5;
}

export function memoOf(g: Game, prev?: GameMemo): GameMemo {
  const m: GameMemo = { state: g.state, away: g.away.score, home: g.home.score };
  if (g.league === 'nba') {
    // Don't remember every basket: NBA alerts only on halftime and close finishes.
    delete m.away;
    delete m.home;
    m.half = prev?.half || /half/i.test(g.status) || undefined;
    m.close = prev?.close || (g.state === 'live' && nbaClose(g)) || undefined;
  }
  return m;
}

function nbaClose(g: Game) {
  return g.home.score != null && g.away.score != null && Math.abs(g.home.score - g.away.score) <= 5 && nbaLate(g.status);
}

const sameMemo = (a?: GameMemo, b?: GameMemo) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function line(g: Game) {
  return `${g.away.abbr} ${g.away.score ?? 0}, ${g.home.abbr} ${g.home.score ?? 0}`;
}

/**
 * Compare a game with what we saw last time and decide which alerts to send.
 * The first sighting of a game never alerts (so subscribing mid-game doesn't spam), except a game
 * that went live within the last 15 minutes, which still gets its "game on" alert.
 */
export function diffGame(
  team: TeamConfig,
  g: Game,
  prev: GameMemo | undefined,
  now = Date.now(),
): { alerts: Alert[]; memo: GameMemo; changed: boolean } {
  const memo = memoOf(g, prev);
  const alerts: Alert[] = [];
  const e = EMOJI[g.league] ?? '';
  const us = g.isHome ? g.home : g.away;
  const them = g.isHome ? g.away : g.home;
  const vs = `${g.isHome ? 'vs' : '@'} ${them.name}`;
  const base = { tag: `${team.key}-${g.id}`, url: `#/game/${team.key}/${g.id}` };

  const wasPre = prev ? prev.state === 'pre' : g.state === 'live' && now - Date.parse(g.start) < 15 * 60_000;

  if (g.state === 'live' && wasPre) {
    alerts.push({ ...base, kind: 'start', title: `${e} ${team.short} ${vs} is on`, body: g.broadcast ? `Watch on ${g.broadcast}` : g.status });
  }

  if (prev && g.state === 'live' && g.league !== 'nba') {
    const dAway = (g.away.score ?? 0) - (prev.away ?? 0);
    const dHome = (g.home.score ?? 0) - (prev.home ?? 0);
    if (dAway > 0 || dHome > 0) {
      const scorer = dAway > 0 && dHome <= 0 ? g.away : dHome > 0 && dAway <= 0 ? g.home : undefined;
      const who = scorer ? (scorer === us ? team.short : scorer.name) : 'Score update';
      alerts.push({ ...base, kind: 'score', title: `${e} ${who}${scorer ? ' score' : ''}`, body: `${line(g)} · ${g.status}` });
    }
  }

  if (prev && g.league === 'nba' && g.state === 'live') {
    if (memo.half && !prev.half) alerts.push({ ...base, kind: 'half', title: `${e} Halftime ${vs}`, body: line(g) });
    if (memo.close && !prev.close) alerts.push({ ...base, kind: 'close', title: `${e} Close game ${vs}`, body: `${line(g)} · ${g.status}` });
  }

  if (prev && prev.state !== 'post' && g.state === 'post') {
    const a = us.score ?? 0;
    const b = them.score ?? 0;
    const verdict = a > b ? 'win' : a < b ? 'lose' : 'tie';
    const extra = g.status !== 'Final' ? ` (${g.status.replace('Final/', '')})` : '';
    alerts.push({ ...base, kind: 'final', title: `${e} Final: ${team.short} ${verdict} ${a}–${b}${extra}`, body: `${vs} · ${line(g)}` });
  }

  return { alerts, memo, changed: !sameMemo(prev, memo) };
}

export function wanted(kind: AlertKind, p: Prefs) {
  if (kind === 'start') return p.start;
  if (kind === 'final') return p.final;
  return p.score;
}
