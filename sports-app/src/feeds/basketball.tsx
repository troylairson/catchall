import { useState } from 'react';
import type { FeedModule } from '../feeds';
import type { TeamConfig } from '../teams';
import { espnSummary, teamIndex } from '../api/espnSummary';
import { Logo } from '../components/Logo';

export interface BballPlay {
  id: string;
  period: number;
  clock: string;
  team?: string;
  text: string;
  scoring: boolean;
  points: number;
  score: string; // away–home after the play
}

export interface BballFeed {
  plays: BballPlay[];
  logos: Record<string, string | undefined>;
}

export const quarterName = (n: number) => (n <= 4 ? `Q${n}` : n === 5 ? 'OT' : `${n - 4}OT`);

export function parseNbaPlays(json: any): BballFeed {
  const teams = teamIndex(json);
  const plays: BballPlay[] = (json.plays ?? []).map((p: any) => ({
    id: String(p.id),
    period: p.period?.number ?? 0,
    clock: p.clock?.displayValue ?? '',
    team: teams[p.team?.id]?.abbr,
    text: String(p.text ?? p.type?.text ?? '').replace(/\s*\n\s*/g, ' '),
    scoring: !!p.scoringPlay,
    points: p.scoreValue ?? 0,
    score: `${p.awayScore ?? 0}–${p.homeScore ?? 0}`,
  }));
  return { plays, logos: Object.fromEntries(Object.values(teams).map((t) => [t.abbr, t.logo])) };
}

function BballFeedView({ data, team }: { data: BballFeed; team: TeamConfig }) {
  const periods = [...new Set(data.plays.map((p) => p.period))].filter((n) => n > 0);
  const [period, setPeriod] = useState<number | 'all'>('all');
  const [scoringOnly, setScoringOnly] = useState(false);
  const shown = [...data.plays]
    .reverse()
    .filter((p) => (period === 'all' || p.period === period) && (!scoringOnly || p.scoring));
  if (!data.plays.length) return <div className="card muted">No plays yet. Check back at tip-off.</div>;
  return (
    <>
      <div className="chips" role="tablist">
        <button className={`chip ${period === 'all' ? 'on' : ''}`} onClick={() => setPeriod('all')}>
          All
        </button>
        {periods.map((n) => (
          <button key={n} className={`chip ${period === n ? 'on' : ''}`} onClick={() => setPeriod(n)}>
            {quarterName(n)}
          </button>
        ))}
        <button className={`chip ${scoringOnly ? 'on' : ''}`} onClick={() => setScoringOnly(!scoringOnly)}>
          Scoring only
        </button>
      </div>
      <ol className="feed card flush">
        {shown.map((p, i) => {
          const prev = shown[i - 1];
          return (
            <li key={p.id} className="ev-wrap">
              {(!prev || prev.period !== p.period) && <div className="ev ev-period small muted">{quarterName(p.period)}</div>}
              <div className={`ev ${p.scoring ? 'ev-goal' : ''} ${p.team === team.abbr ? 'ours' : ''}`}>
                <span className="ev-time small muted">{p.clock}</span>
                {p.team ? <Logo src={data.logos[p.team]} alt={p.team} size={22} /> : <span style={{ width: 22 }} />}
                <span className="ev-text">{p.text}</span>
                {p.scoring && <span className="ev-score">{p.score}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export const basketball: FeedModule<BballFeed> = {
  async load(team, gameId) {
    const { game, json } = await espnSummary(team, gameId);
    return { game, data: parseNbaPlays(json) };
  },
  Feed: BballFeedView,
};
