import { useState } from 'react';
import type { FeedModule } from '../feeds';
import { espnSummary } from '../api/espnSummary';
import { Logo } from '../components/Logo';

export interface Play {
  id: string;
  quarter: number;
  clock: string;
  down?: string; // "3rd & 4 at PIT 35"
  text: string;
  type?: string;
  scoring: boolean;
  turnover: boolean;
  penalty: boolean;
  yards?: number;
  score: string; // "7–3" away–home after the play
}

export interface Drive {
  id: string;
  team: string;
  teamName: string;
  logo?: string;
  result: string;
  summary: string; // "8 plays, 75 yards, 4:12"
  start: string; // "Q1 15:00 · PIT 25"
  isScore: boolean;
  current: boolean;
  plays: Play[];
}

const ord = (n: number) => (n <= 4 ? `Q${n}` : n === 5 ? 'OT' : `${n - 4}OT`);

export function parseDrives(json: any): Drive[] {
  const raw = [...(json.drives?.previous ?? [])];
  const cur = json.drives?.current;
  if (cur && !raw.some((d) => d.id === cur.id)) raw.push({ ...cur, __current: true });
  return raw.map((d: any) => {
    const t = d.team ?? {};
    const plays: Play[] = (d.plays ?? []).map((p: any) => ({
      id: String(p.id),
      quarter: p.period?.number ?? 0,
      clock: p.clock?.displayValue ?? '',
      down: p.start?.down > 0 ? p.start.downDistanceText : undefined,
      text: p.text ?? '',
      type: p.type?.text,
      scoring: !!p.scoringPlay,
      turnover: !!p.isTurnover,
      penalty: !!p.isPenalty,
      yards: p.statYardage,
      score: `${p.awayScore ?? 0}–${p.homeScore ?? 0}`,
    }));
    const live = !!d.__current || (cur?.id === d.id);
    return {
      id: String(d.id),
      team: t.abbreviation ?? '',
      teamName: t.shortDisplayName ?? t.name ?? '',
      logo: t.logos?.[0]?.href ?? t.logo,
      result: live && !d.result ? 'In progress' : d.displayResult ?? d.result ?? '',
      summary: d.description ?? '',
      start: [d.start?.period?.number ? `${ord(d.start.period.number)} ${d.start.clock?.displayValue ?? ''}`.trim() : '', d.start?.text]
        .filter(Boolean)
        .join(' · '),
      isScore: !!d.isScore,
      current: live,
      plays,
    };
  });
}

function DriveRow({ d, open, onToggle, ours }: { d: Drive; open: boolean; onToggle: () => void; ours: boolean }) {
  const last = d.plays[d.plays.length - 1];
  return (
    <li className={`drive ${d.current ? 'current' : ''} ${d.isScore ? 'scored' : ''} ${ours ? 'ours' : ''}`}>
      <button className="drive-head" onClick={onToggle} aria-expanded={open}>
        <Logo src={d.logo} alt={d.team} size={28} />
        <span className="drive-main">
          <span className="drive-result">
            {d.current && <span className="dot" aria-hidden />}
            {d.result}
          </span>
          <span className="muted small">
            {d.summary}
            {d.start && ` · ${d.start}`}
          </span>
        </span>
        <span className="drive-score small">{last?.score}</span>
      </button>
      {open && (
        <ol className="plays">
          {[...d.plays].reverse().map((p) => (
            <li key={p.id} className={`play ${p.scoring ? 'scoring' : ''} ${p.turnover ? 'turnover' : ''}`}>
              <div className="play-meta small muted">
                {ord(p.quarter)} {p.clock}
                {p.down && ` · ${p.down}`}
              </div>
              <div className="play-text">{p.text}</div>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Drives({ data, team }: { data: Drive[]; team: { abbr: string } }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const drives = [...data].reverse();
  if (!drives.length) return <div className="card muted">No drives yet. Check back at kickoff.</div>;
  return (
    <>
      <h3 className="feed-title">Drives</h3>
      <ol className="feed card flush">
        {drives.map((d, i) => (
          <DriveRow
            key={d.id}
            d={d}
            ours={d.team === team.abbr}
            open={open[d.id] ?? (i === 0 && d.current)}
            onToggle={() => setOpen((o) => ({ ...o, [d.id]: !(o[d.id] ?? (i === 0 && d.current)) }))}
          />
        ))}
      </ol>
    </>
  );
}

export const football: FeedModule<Drive[]> = {
  async load(team, gameId) {
    const { game, json } = await espnSummary(team, gameId);
    return { game, data: parseDrives(json) };
  },
  Feed: Drives,
};
