export type League = 'nfl' | 'nhl' | 'nba' | 'mlb';

/** pre = scheduled, live = in progress, post = final, off = postponed/cancelled. */
export type GameState = 'pre' | 'live' | 'post' | 'off';

export interface Side {
  abbr: string;
  name: string; // short name, e.g. "Bengals"
  logo?: string;
  score?: number;
  record?: string;
}

export interface Game {
  id: string;
  league: League;
  start: string; // ISO UTC
  timeTBD?: boolean;
  state: GameState;
  /** Short status for the card: "Final", "Final/OT", "Q3 4:12", "Top 5th", "Postponed". */
  status: string;
  /** Extra live line: "2nd & 7 at CIN 35", "1 out, runner on 2nd". */
  situation?: string;
  home: Side;
  away: Side;
  /** Our team is home? */
  isHome: boolean;
  /** "Wild Card", "ALCS Game 3", "Spring training", "Opening Day" … */
  label?: string;
  broadcast?: string;
}

export interface TeamSnapshot {
  live?: Game;
  last?: Game;
  next?: Game;
  /** Shown when there is no next game, or as context (e.g. "Spring training starts Feb 19"). */
  note?: string;
  record?: string;
  standing?: string;
  updated: number;
}
