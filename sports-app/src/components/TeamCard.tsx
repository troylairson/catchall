import type { CSSProperties } from 'react';
import type { TeamConfig } from '../teams';
import type { Game, TeamSnapshot } from '../types';
import { opponent, result } from '../snapshot';
import { agoLabel, whenLabel } from '../time';
import { Logo } from './Logo';

const LEAGUE: Record<string, string> = { nfl: 'NFL', nhl: 'NHL', nba: 'NBA', mlb: 'MLB' };

function vs(g: Game) {
  return g.isHome ? 'vs' : '@';
}

export function Scoreline({ g, big }: { g: Game; big?: boolean }) {
  const size = big ? 44 : 32;
  const lead = g.home.score != null && g.away.score != null ? Math.sign(g.home.score - g.away.score) : 0;
  return (
    <div className={`scoreline ${big ? 'big' : ''}`}>
      <div className={`sl-team ${lead > 0 ? 'trail' : ''}`}>
        <Logo src={g.away.logo} alt={g.away.abbr} size={size} />
        <span className="sl-abbr">{g.away.abbr}</span>
        <span className="sl-score">{g.away.score ?? ''}</span>
      </div>
      <div className={`sl-team ${lead < 0 ? 'trail' : ''}`}>
        <Logo src={g.home.logo} alt={g.home.abbr} size={size} />
        <span className="sl-abbr">{g.home.abbr}</span>
        <span className="sl-score">{g.home.score ?? ''}</span>
      </div>
    </div>
  );
}

function LiveBlock({ g }: { g: Game }) {
  return (
    <div className="live">
      <div className="live-status">
        <span className="dot" aria-hidden /> LIVE · {g.status}
        {g.broadcast && <span className="muted"> · {g.broadcast}</span>}
      </div>
      <Scoreline g={g} big />
      {g.situation && <div className="situation">{g.situation}</div>}
    </div>
  );
}

function LastLine({ g }: { g: Game }) {
  const r = result(g);
  const o = opponent(g);
  const usScore = g.isHome ? g.home.score : g.away.score;
  return (
    <div className="row">
      <span className={`badge ${r === 'W' ? 'win' : r === 'L' ? 'loss' : ''}`}>{r ?? '–'}</span>
      <span className="row-main">
        {usScore}–{o.score} {vs(g)} {o.name}
        {g.status !== 'Final' && <span className="muted"> ({g.status.replace('Final/', '')})</span>}
      </span>
      <span className="row-side muted">{agoLabel(g.start)}</span>
    </div>
  );
}

function NextLine({ g }: { g: Game }) {
  const o = opponent(g);
  return (
    <div className="row">
      <span className="badge next">Next</span>
      <span className="row-main">
        {g.label && <span className="tag">{g.label}</span>}
        {vs(g)} {o.name}
        <span className="when">
          {whenLabel(g.start, new Date(), g.timeTBD)}
          {g.broadcast && ` · ${g.broadcast}`}
        </span>
      </span>
      <Logo src={o.logo} alt={o.abbr} size={28} />
    </div>
  );
}

export function TeamCard({
  team,
  snap,
  error,
  onOpen,
}: {
  team: TeamConfig;
  snap?: TeamSnapshot;
  error?: string;
  onOpen: (gameId: string) => void;
}) {
  const style = { '--team': team.primary, '--team2': team.secondary } as CSSProperties;
  const target = snap?.live ?? snap?.last;
  return (
    <article
      className={`card ${snap?.live ? 'is-live' : ''}`}
      style={style}
      onClick={target ? () => onOpen(target.id) : undefined}
      role={target ? 'button' : undefined}
      tabIndex={target ? 0 : undefined}
      onKeyDown={(e) => target && (e.key === 'Enter' || e.key === ' ') && onOpen(target.id)}
      aria-label={target ? `${team.name}: open play-by-play` : team.name}
    >
      <header className="card-head">
        <Logo src={team.logo} dark={team.logoDark} alt={team.abbr} size={40} />
        <div className="card-title">
          <h2>{team.short}</h2>
          <div className="muted small">
            {LEAGUE[team.league]}
            {snap?.record && ` · ${snap.record}`}
            {snap?.standing && ` · ${snap.standing}`}
          </div>
        </div>
        {target && <span className="chev" aria-hidden>›</span>}
      </header>

      {!snap && !error && <div className="skeleton" />}
      {!snap && error && <div className="error small">Couldn’t load scores. Pull down or tap refresh.</div>}

      {snap?.live && <LiveBlock g={snap.live} />}
      {snap && !snap.live && snap.last && <LastLine g={snap.last} />}
      {snap?.next && <NextLine g={snap.next} />}
      {snap?.note && <div className="note small">{snap.note}</div>}
    </article>
  );
}
