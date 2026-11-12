import { useCallback, useEffect, useRef, useState } from 'react';
import { TEAMS, type TeamConfig } from './teams';
import type { Game, TeamSnapshot } from './types';
import { loadLive, loadSchedule, sourceOf } from './api';
import type { TeamSchedule } from './api/espn';
import { mergeGames, pollDelay, snapshotFrom } from './snapshot';

interface TeamData {
  schedule?: TeamSchedule;
  scheduleAt: number;
  source?: string;
  live: Game[];
  error?: string;
}

const CACHE_KEY = 'scores.cache.v1';
const SCHEDULE_TTL = 30 * 60_000;

function readCache(): Record<string, TeamData> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function writeCache(d: Record<string, TeamData>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function snapshotOf(d: TeamData | undefined, now = Date.now()): TeamSnapshot | undefined {
  if (!d?.schedule) return undefined;
  const s = snapshotFrom(mergeGames(d.schedule.games, d.live), now, d.schedule.note);
  return { ...s, record: d.schedule.record, standing: d.schedule.standing, updated: d.scheduleAt };
}

/** Is this team's game live, or starting within 15 minutes? */
function hot(d: TeamData | undefined, now: number) {
  const s = snapshotOf(d, now);
  if (!s) return false;
  if (s.live) return true;
  const n = s.next ? Date.parse(s.next.start) : NaN;
  return n - now < 15 * 60_000 && n - now > -6 * 3600_000;
}

export function useScores() {
  const [data, setData] = useState<Record<string, TeamData>>(readCache);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const dataRef = useRef(data);
  dataRef.current = data;

  const refreshTeam = useCallback(async (cfg: TeamConfig, full: boolean) => {
    const prev = dataRef.current[cfg.key];
    const now = Date.now();
    const source = sourceOf(cfg);
    const needSchedule = full || !prev?.schedule || prev.source !== source || now - prev.scheduleAt > SCHEDULE_TTL;
    if (!needSchedule && !hot(prev, now)) return;
    try {
      const [schedule, live] = await Promise.all([
        needSchedule ? loadSchedule(cfg) : Promise.resolve(prev!.schedule!),
        loadLive(cfg).catch(() => prev?.live ?? []),
      ]);
      setData((d) => ({
        ...d,
        [cfg.key]: { schedule, live, source, scheduleAt: needSchedule ? Date.now() : d[cfg.key]?.scheduleAt ?? now },
      }));
    } catch (e) {
      setData((d) => ({ ...d, [cfg.key]: { ...(d[cfg.key] ?? { scheduleAt: 0, live: [] }), error: String((e as Error).message ?? e) } }));
    }
  }, []);

  const refresh = useCallback(
    async (full = false) => {
      setLoading(true);
      await Promise.all(TEAMS.map((t) => refreshTeam(t, full)));
      setLoading(false);
      setUpdatedAt(Date.now());
    },
    [refreshTeam],
  );

  useEffect(() => writeCache(data), [data]);

  // Polling loop: 20s while anything is live (or about to start), 5 min otherwise. Paused in background.
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const tick = async (full: boolean) => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      await refresh(full);
      if (stopped) return;
      const snaps = TEAMS.map((t) => snapshotOf(dataRef.current[t.key]));
      timer = window.setTimeout(() => tick(false), pollDelay(snaps));
    };
    const onVis = () => {
      if (!document.hidden) tick(false);
      else window.clearTimeout(timer);
    };
    tick(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [refresh]);

  const snapshots = Object.fromEntries(TEAMS.map((t) => [t.key, snapshotOf(data[t.key])]));
  const errors = Object.fromEntries(TEAMS.map((t) => [t.key, data[t.key]?.error]));
  const games = (key: string) => {
    const d = data[key];
    return d?.schedule ? mergeGames(d.schedule.games, d.live) : [];
  };
  return { snapshots, errors, loading, updatedAt, refresh, games };
}
