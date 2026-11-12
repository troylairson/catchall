import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { teamStyle, type TeamConfig } from '../teams';
import type { Game } from '../types';
import { Scoreline } from '../components/TeamCard';
import { whenLabel } from '../time';
import { FEEDS } from '../feeds';
import { News } from '../components/News';

export function GameView({ team, gameId, summary }: { team: TeamConfig; gameId: string; summary?: Game }) {
  const feed = FEEDS[team.league];
  const [detail, setDetail] = useState<{ game?: Game; data: any }>();
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState<number>();
  const [tab, setTab] = useState<'pbp' | 'news'>('pbp');
  const liveRef = useRef(summary?.state === 'live');

  useEffect(() => {
    if (!feed) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      try {
        const d = await feed.load(team, gameId);
        if (stop) return;
        setDetail(d);
        setError(undefined);
        setUpdated(Date.now());
        liveRef.current = (d.game ?? summary)?.state === 'live';
      } catch (e) {
        if (!stop) setError(String((e as Error).message ?? e));
      }
      if (!stop && liveRef.current) timer = window.setTimeout(tick, 20_000);
    };
    const onVis = () => !document.hidden && tick();
    tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [team, gameId, feed]);

  // The schedule knows labels like "ALCS · Game 6" or "Opening Day" that game feeds lack.
  const game = detail?.game ? { ...detail.game, label: summary?.label ?? detail.game.label } : summary;
  const style = teamStyle(team) as CSSProperties;
  const Feed = feed?.Feed;

  return (
    <div className="app game" style={style}>
      <header className="topbar">
        <button className="back" onClick={() => (history.length > 1 ? history.back() : (location.hash = ''))}>
          ‹ Scores
        </button>
        <span className="muted small">{updated && game?.state === 'live' ? 'Live · auto-updating' : ''}</span>
      </header>
      {game && (
        <section className="game-head card">
          <div className="game-status">
            {game.state === 'live' && <span className="dot" aria-hidden />}
            {game.state === 'pre' ? whenLabel(game.start, new Date(), game.timeTBD) : game.status}
            {game.label && <span className="tag">{game.label}</span>}
          </div>
          <Scoreline g={game} big />
          {game.situation && <div className="situation">{game.situation}</div>}
        </section>
      )}
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'pbp'} className={tab === 'pbp' ? 'on' : ''} onClick={() => setTab('pbp')}>
          Play-by-play
        </button>
        <button role="tab" aria-selected={tab === 'news'} className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>
          {team.short} news
        </button>
      </div>
      {tab === 'news' && <News team={team} />}
      {tab === 'pbp' && (
        <>
          {error && !detail && <div className="card error">Couldn’t load play-by-play: {error}</div>}
          {!feed && <div className="card muted">Play-by-play for this sport is coming soon.</div>}
          {feed && !detail && !error && <div className="card skeleton tall" />}
          {Feed && detail && <Feed data={detail.data} team={team} game={game} />}
        </>
      )}
    </div>
  );
}
