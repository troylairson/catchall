import { useState } from 'react';
import type { FeedModule } from '../feeds';
import type { TeamConfig } from '../teams';
import { getJson } from '../api/http';
import { MLB, mlbGame, mlbSituation } from '../api/mlb';
import { Logo } from '../components/Logo';

export interface Pitch {
  n: number;
  call: string; // "Ball", "Called Strike", "In play, run(s)"
  type?: string; // "Four-Seam Fastball"
  mph?: number;
  count: string; // "1-2" after the pitch
  kind: 'ball' | 'strike' | 'inplay';
}

export interface AtBat {
  id: number;
  inning: number;
  top: boolean;
  batter: string;
  pitcher: string;
  result?: string; // "Single", "Strikeout"
  description?: string;
  scoring: boolean;
  score: string; // away–home after the at-bat
  outs: number;
  complete: boolean;
  /** Pitches and in-between actions (steals, pitching changes), in order. */
  events: ({ pitch: Pitch } | { action: string })[];
}

export interface Linescore {
  innings: { num: number; away?: number; home?: number }[];
  away: { abbr: string; r: number; h: number; e: number; logo: string };
  home: { abbr: string; r: number; h: number; e: number; logo: string };
}

export interface BaseballFeed {
  atBats: AtBat[];
  linescore?: Linescore;
  situation?: string;
  count?: string;
}

const SKIP_ACTIONS = /Game Advisory|Batter Timeout|Mound Visit|Status Change/i;

export function parseMlbFeed(json: any): BaseballFeed {
  const all: any[] = json.liveData?.plays?.allPlays ?? [];
  const atBats: AtBat[] = all.map((a) => {
    const events: AtBat['events'] = [];
    for (const e of a.playEvents ?? []) {
      if (e.isPitch) {
        const d = e.details ?? {};
        events.push({
          pitch: {
            n: e.pitchNumber ?? events.length + 1,
            call: d.description ?? d.call?.description ?? '',
            type: d.type?.description,
            mph: e.pitchData?.startSpeed,
            count: `${e.count?.balls ?? 0}-${e.count?.strikes ?? 0}`,
            kind: d.isInPlay ? 'inplay' : d.isStrike ? 'strike' : 'ball',
          },
        });
      } else if (e.details?.description && !SKIP_ACTIONS.test(`${e.details.event ?? ''} ${e.details.description}`)) {
        events.push({ action: e.details.description });
      }
    }
    return {
      id: a.atBatIndex ?? a.about?.atBatIndex,
      inning: a.about?.inning ?? 0,
      top: !!a.about?.isTopInning,
      batter: a.matchup?.batter?.fullName ?? '',
      pitcher: a.matchup?.pitcher?.fullName ?? '',
      result: a.about?.isComplete ? a.result?.event : undefined,
      description: a.about?.isComplete ? a.result?.description : undefined,
      scoring: !!a.about?.isScoringPlay,
      score: `${a.result?.awayScore ?? 0}–${a.result?.homeScore ?? 0}`,
      outs: a.count?.outs ?? 0,
      complete: !!a.about?.isComplete,
      events,
    };
  });

  const ls = json.liveData?.linescore;
  const teams = json.gameData?.teams ?? {};
  const linescore: Linescore | undefined = ls
    ? {
        innings: (ls.innings ?? []).map((i: any) => ({ num: i.num, away: i.away?.runs, home: i.home?.runs })),
        away: { abbr: teams.away?.abbreviation, r: ls.teams?.away?.runs ?? 0, h: ls.teams?.away?.hits ?? 0, e: ls.teams?.away?.errors ?? 0, logo: `https://www.mlbstatic.com/team-logos/${teams.away?.id}.svg` },
        home: { abbr: teams.home?.abbreviation, r: ls.teams?.home?.runs ?? 0, h: ls.teams?.home?.hits ?? 0, e: ls.teams?.home?.errors ?? 0, logo: `https://www.mlbstatic.com/team-logos/${teams.home?.id}.svg` },
      }
    : undefined;
  const live = json.gameData?.status?.abstractGameState === 'Live';
  return {
    atBats,
    linescore,
    situation: live ? mlbSituation(ls) : undefined,
    count: live && ls ? `${ls.balls ?? 0}-${ls.strikes ?? 0}` : undefined,
  };
}

/** Shape the live feed like a schedule entry so the card parser can read it. */
export function gameFromFeed(json: any, teamId: number) {
  const gd = json.gameData ?? {};
  const ls = json.liveData?.linescore ?? {};
  return mlbGame(
    {
      gamePk: gd.game?.pk,
      gameType: gd.game?.type,
      season: gd.game?.season,
      gameDate: gd.datetime?.dateTime,
      status: gd.status,
      teams: {
        home: { team: gd.teams?.home, score: ls.teams?.home?.runs },
        away: { team: gd.teams?.away, score: ls.teams?.away?.runs },
      },
      linescore: ls,
    },
    teamId,
  );
}

export const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
const half = (ab: AtBat) => `${ab.top ? 'Top' : 'Bottom'} ${ordinal(ab.inning)}`;

function LinescoreTable({ ls }: { ls: Linescore }) {
  const n = Math.max(9, ls.innings.length);
  const cols = Array.from({ length: n }, (_, i) => ls.innings[i] ?? { num: i + 1 });
  return (
    <div className="card flush linescore-wrap">
      <table className="linescore">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c.num}>{c.num}</th>
            ))}
            <th className="rhe">R</th>
            <th className="rhe">H</th>
            <th className="rhe">E</th>
          </tr>
        </thead>
        <tbody>
          {(['away', 'home'] as const).map((side) => (
            <tr key={side}>
              <th>
                <Logo src={ls[side].logo} alt={ls[side].abbr} size={18} /> {ls[side].abbr}
              </th>
              {cols.map((c) => (
                <td key={c.num}>{c[side] ?? ''}</td>
              ))}
              <td className="rhe">{ls[side].r}</td>
              <td className="rhe">{ls[side].h}</td>
              <td className="rhe">{ls[side].e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AtBatRow({ ab, open, onToggle }: { ab: AtBat; open: boolean; onToggle: () => void }) {
  const pitches = ab.events.filter((e): e is { pitch: Pitch } => 'pitch' in e);
  return (
    <li className={`ab ${ab.scoring ? 'scored' : ''} ${ab.complete ? '' : 'current'}`}>
      <button className="ab-head" onClick={onToggle} aria-expanded={open}>
        <span className="ab-main">
          <span className="ab-result">
            {!ab.complete && <span className="dot" aria-hidden />}
            {ab.complete ? ab.result : `${ab.batter} batting`}
          </span>
          <span className="small muted">
            {ab.complete ? ab.description : `vs ${ab.pitcher}`}
          </span>
        </span>
        <span className="ab-side small">
          {ab.scoring && <strong>{ab.score}</strong>}
          <span className="muted">
            {pitches.length} pitch{pitches.length === 1 ? '' : 'es'}
          </span>
        </span>
      </button>
      {open && (
        <ol className="pitches">
          <li className="small muted">
            {ab.batter} vs {ab.pitcher}
          </li>
          {ab.events.map((e, i) =>
            'pitch' in e ? (
              <li key={i} className={`pitch ${e.pitch.kind}`}>
                <span className="pitch-n">{e.pitch.n}</span>
                <span className="pitch-call">{e.pitch.call}</span>
                <span className="pitch-type small muted">
                  {[e.pitch.type, e.pitch.mph && `${e.pitch.mph.toFixed(1)} mph`].filter(Boolean).join(' · ')}
                </span>
                <span className="pitch-count small">{e.pitch.call.startsWith('In play') ? '' : e.pitch.count}</span>
              </li>
            ) : (
              <li key={i} className="action small muted">
                {e.action}
              </li>
            ),
          )}
        </ol>
      )}
    </li>
  );
}

function BaseballFeedView({ data }: { data: BaseballFeed; team: TeamConfig }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const abs = [...data.atBats].reverse();
  if (!abs.length) {
    return (
      <>
        {data.linescore && <LinescoreTable ls={data.linescore} />}
        <div className="card muted">No pitches yet. Check back at first pitch.</div>
      </>
    );
  }
  return (
    <>
      {data.linescore && <LinescoreTable ls={data.linescore} />}
      {data.count && (
        <div className="card stat-strip">
          <span className="muted small">Count</span>
          <strong>{data.count}</strong>
        </div>
      )}
      <ol className="feed card flush">
        {abs.map((ab, i) => {
          const prev = abs[i - 1];
          const isOpen = open[ab.id] ?? !ab.complete;
          return (
            <li key={ab.id} className="ev-wrap">
              {(!prev || prev.inning !== ab.inning || prev.top !== ab.top) && (
                <div className="ev ev-period small muted">{half(ab)}</div>
              )}
              <ol className="feed">
                <AtBatRow ab={ab} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [ab.id]: !isOpen }))} />
              </ol>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export const baseball: FeedModule<BaseballFeed> = {
  async load(team, gameId) {
    const json = await getJson(`${MLB}/api/v1.1/game/${gameId}/feed/live`);
    return { game: gameFromFeed(json, team.mlb!.teamId), data: parseMlbFeed(json) };
  },
  Feed: BaseballFeedView,
};
