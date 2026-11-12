import type { ComponentType } from 'react';
import type { League, Game } from './types';
import type { TeamConfig } from './teams';
import { football } from './feeds/football';
import { hockey } from './feeds/hockey';

export interface FeedModule<T = any> {
  load: (team: TeamConfig, gameId: string) => Promise<{ game?: Game; data: T }>;
  Feed: ComponentType<{ data: T; team: TeamConfig; game?: Game }>;
}

/** Play-by-play views, one per sport. */
export const FEEDS: Partial<Record<League, FeedModule>> = {
  nfl: football,
  nhl: hockey,
};
