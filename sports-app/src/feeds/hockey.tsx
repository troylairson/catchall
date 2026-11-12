import { useState } from 'react';
import type { FeedModule } from '../feeds';
import { abbrsOf, type TeamConfig } from '../teams';
import type { Game } from '../types';
import { nhlBase, getJson } from '../api/http';
import { nhlGame, periodName } from '../api/nhl';
import { espnSummary, teamIndex } from '../api/espnSummary';
import { Logo } from '../components/Logo';

export type Kind = 'goal' | 'shot' | 'miss' | 'block' | 'penalty' | 'hit' | 'faceoff' | 'turnover' | 'period' | 'other';

export interface HockeyEvent {
  id: string;
  period: string; // "1st", "OT"
  clock: string; // elapsed in period
  kind: Kind;
  team?: string;
  text: string;
  score?: string; // "1–0" away–home after a goal
}

export interface HockeyFeed {
  events: HockeyEvent[];
  shots?: { away: number; home: number; awayAbbr: string; homeAbbr: string };
  logos: Record<string, string | undefined>;
  source: 'NHL' | 'ESPN';
}

const KEY: Kind[] = ['goal', 'penalty', 'shot', 'period'];

// ---------- NHL api-web ----------

const SHOT_TYPES: Record<string, string> = { 'wrap-around': 'wraparound', 'tip-in': 'tip-in', 'bat': 'batted', 'between-legs': 'between-the-legs' };

export function parseNhlPbp(json: any): HockeyFeed {
  const players: Record<number, string> = {};
  for (const r of json.rosterSpots ?? []) {
    players[r.playerId] = `${r.firstName?.default?.[0] ?? ''}. ${r.lastName?.default ?? ''}`.trim();
  }
  const who = (id?: number) => (id ? players[id] ?? `#${id}` : 'Unknown');
  const teams: Record<number, string> = { [json.homeTeam?.id]: json.homeTeam?.abbrev, [json.awayTeam?.id]: json.awayTeam?.abbrev };
  const events: HockeyEvent[] = [];
  for (const p of json.plays ?? []) {
    const d = p.details ?? {};
    const team = teams[d.eventOwnerTeamId];
    const shot = d.shotType ? `${SHOT_TYPES[d.shotType] ?? d.shotType} shot` : 'shot';
    let kind: Kind = 'other';
    let text = '';
    let score: string | undefined;
    switch (p.typeDescKey) {
      case 'goal': {
        kind = 'goal';
        const assists = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map(who);
        text = `GOAL — ${who(d.scoringPlayerId)} (${d.scoringPlayerTotal ?? '?'}), ${shot}${assists.length ? ` · Assists: ${assists.join(', ')}` : ' · Unassisted'}`;
        score = `${d.awayScore}–${d.homeScore}`;
        break;
      }
      case 'shot-on-goal':
        kind = 'shot';
        text = `${who(d.shootingPlayerId)} ${shot}, saved by ${d.goalieInNetId ? who(d.goalieInNetId) : 'empty net?'}`;
        break;
      case 'missed-shot':
        kind = 'miss';
        text = `${who(d.shootingPlayerId)} ${shot} missed${d.reason ? ` (${d.reason.replace(/-/g, ' ')})` : ''}`;
        break;
      case 'blocked-shot':
        kind = 'block';
        text = `${who(d.shootingPlayerId)} shot blocked by ${who(d.blockingPlayerId)}`;
        break;
      case 'penalty':
        kind = 'penalty';
        text = `Penalty — ${d.committedByPlayerId ? who(d.committedByPlayerId) : 'bench'}, ${(d.descKey ?? '').replace(/-/g, ' ')} (${d.duration} min)`;
        break;
      case 'hit':
        kind = 'hit';
        text = `${who(d.hittingPlayerId)} hit ${who(d.hitteePlayerId)}`;
        break;
      case 'faceoff':
        kind = 'faceoff';
        text = `${who(d.winningPlayerId)} won faceoff vs ${who(d.losingPlayerId)}`;
        break;
      case 'giveaway':
      case 'takeaway':
        kind = 'turnover';
        text = `${p.typeDescKey === 'giveaway' ? 'Giveaway' : 'Takeaway'} — ${who(d.playerId)}`;
        break;
      case 'period-start':
      case 'period-end':
      case 'game-end':
      case 'shootout-complete':
        kind = 'period';
        text = p.typeDescKey === 'game-end' ? 'End of game' : `${p.typeDescKey === 'period-start' ? 'Start' : 'End'} of ${periodName(p.periodDescriptor)}`;
        break;
      default:
        continue; // stoppages, delayed penalties etc.
    }
    events.push({
      id: String(p.eventId),
      period: periodName(p.periodDescriptor),
      clock: p.timeInPeriod ?? '',
      kind,
      team: kind === 'period' ? undefined : team,
      text,
      score,
    });
  }
  return {
    events,
    shots:
      json.homeTeam?.sog != null
        ? { away: json.awayTeam.sog, home: json.homeTeam.sog, awayAbbr: json.awayTeam.abbrev, homeAbbr: json.homeTeam.abbrev }
        : undefined,
    logos: { [json.homeTeam?.abbrev]: json.homeTeam?.logo, [json.awayTeam?.abbrev]: json.awayTeam?.logo },
    source: 'NHL',
  };
}

// ---------- ESPN ----------

const ESPN_KIND: Record<string, Kind> = {
  '505': 'goal',
  '506': 'shot',
  '507': 'miss',
  '508': 'block',
  '503': 'hit',
  '502': 'faceoff',
  '1401': 'turnover',
  '1402': 'turnover',
  '518': 'period',
  '519': 'period',
  '522': 'period',
};

export function parseEspnHockey(json: any): HockeyFeed {
  const teams = teamIndex(json);
  const events: HockeyEvent[] = [];
  for (const p of json.plays ?? []) {
    const t = p.type ?? {};
    let kind: Kind | undefined = ESPN_KIND[t.id];
    if (!kind && t.penaltyMinutes) kind = 'penalty';
    if (!kind) continue;
    let text: string = p.text ?? t.text;
    if (kind === 'goal') text = `GOAL — ${text}`;
    if (kind === 'penalty') text = `Penalty — ${text} (${t.penaltyMinutes} min)`;
    events.push({
      id: String(p.id),
      period: p.period?.displayValue ?? periodName({ number: p.period?.number, periodType: 'REG' }),
      clock: p.clock?.displayValue ?? '',
      kind,
      team: kind === 'period' ? undefined : teams[p.team?.id]?.abbr,
      text,
      score: kind === 'goal' ? `${p.awayScore}–${p.homeScore}` : undefined,
    });
  }
  const box: any[] = json.boxscore?.teams ?? [];
  const shotsOf = (abbr: string) =>
    Number(box.find((b) => b.team?.abbreviation === abbr)?.statistics?.find((s: any) => s.name === 'shotsTotal')?.displayValue);
  const comp = json.header?.competitions?.[0];
  const homeAbbr = comp?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.abbreviation;
  const awayAbbr = comp?.competitors?.find((c: any) => c.homeAway === 'away')?.team?.abbreviation;
  const sh = shotsOf(homeAbbr);
  const sa = shotsOf(awayAbbr);
  return {
    events,
    shots: Number.isFinite(sh) && Number.isFinite(sa) ? { home: sh, away: sa, homeAbbr, awayAbbr } : undefined,
    logos: Object.fromEntries(Object.values(teams).map((t) => [t.abbr, t.logo])),
    source: 'ESPN',
  };
}

// ---------- view ----------

const ICON: Partial<Record<Kind, string>> = { goal: '🚨', penalty: '⏱', shot: '🥅' };

function HockeyFeedView({ data, team, game }: { data: HockeyFeed; team: TeamConfig; game?: Game }) {
  const [all, setAll] = useState(false);
  const shown = [...data.events].reverse().filter((e) => all || KEY.includes(e.kind));
  const goals = data.events.filter((e) => e.kind === 'goal');
  return (
    <>
      {data.shots && !game?.situation?.startsWith('Shots') && (
        <div className="card stat-strip">
          <span className="muted small">Shots on goal</span>
          <strong>
            {data.shots.awayAbbr} {data.shots.away} – {data.shots.home} {data.shots.homeAbbr}
          </strong>
        </div>
      )}
      {goals.length > 0 && (
        <>
          <h3 className="feed-title">Scoring</h3>
          <ol className="feed card flush">
            {goals.map((e) => (
              <EventRow key={e.id} e={e} logo={data.logos[e.team ?? '']} ours={abbrsOf(team).has(e.team ?? '')} />
            ))}
          </ol>
        </>
      )}
      <div className="feed-bar">
        <h3 className="feed-title">{all ? 'All events' : 'Shots, goals & penalties'}</h3>
        <button className="chip" onClick={() => setAll(!all)}>
          {all ? 'Key events' : 'Show all'}
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="card muted">Nothing yet. Check back at puck drop.</div>
      ) : (
        <ol className="feed card flush">
          {shown.map((e) => (
            <EventRow key={e.id} e={e} logo={data.logos[e.team ?? '']} ours={abbrsOf(team).has(e.team ?? '')} />
          ))}
        </ol>
      )}
      <p className="muted small source">Source: {data.source}</p>
    </>
  );
}

function EventRow({ e, logo, ours }: { e: HockeyEvent; logo?: string; ours: boolean }) {
  if (e.kind === 'period') {
    return <li className="ev ev-period small muted">{e.text}</li>;
  }
  return (
    <li className={`ev ev-${e.kind} ${ours ? 'ours' : ''}`}>
      <span className="ev-time small muted">
        {e.period}
        <br />
        {e.clock}
      </span>
      {e.team ? <Logo src={logo} alt={e.team} size={22} /> : <span style={{ width: 22 }} />}
      <span className="ev-text">
        {ICON[e.kind] && <span aria-hidden>{ICON[e.kind]} </span>}
        {e.text}
      </span>
      {e.score && <span className="ev-score">{e.score}</span>}
    </li>
  );
}

export const hockey: FeedModule<HockeyFeed> = {
  async load(team, gameId) {
    const base = nhlBase();
    // NHL game ids are 10 digits starting with the season (2026020282); ESPN ids are 9 digits.
    if (base && /^20\d{8}$/.test(gameId)) {
      const json = await getJson(`${base}/v1/gamecenter/${gameId}/play-by-play`);
      return { game: nhlGame(json, team.nhl!.abbr), data: parseNhlPbp(json) };
    }
    const { game, json } = await espnSummary(team, gameId);
    return { game, data: parseEspnHockey(json) };
  },
  Feed: HockeyFeedView,
};
