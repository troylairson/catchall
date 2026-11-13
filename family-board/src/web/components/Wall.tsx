import { useEffect, useRef, useState } from 'react';
import type { Board } from '../../shared/types';
import { dayOfMonth, formatTime, monthName, weekdayName } from '../../shared/dates';
import { activeTrip, isDimTime, itemsOn, nowMinutes, personById, tripProgress } from '../lib';
import { useNow } from '../api';
import { Avatar, Sleeps } from './Avatar';
import { TodayView } from './TodayView';
import { WeekView } from './WeekView';
import { KidsView } from './KidsView';

type View = 'today' | 'week' | 'kids';

function clock(board: Board, now: Date) {
  const { minutes } = nowMinutes(board, now);
  const t = formatTime(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  return { time: t.replace(/ [AP]M$/, ''), ampm: t.slice(-2), full: t };
}

function AwayBanners({ board }: { board: Board }) {
  const away = board.people
    .map(p => ({ p, trip: activeTrip(board, p.id, board.today) }))
    .filter(x => x.trip);
  if (!away.length) return null;
  return (
    <div className="away-list">
      {away.map(({ p, trip }) => {
        const prog = tripProgress(trip!, board.today);
        return (
          <div key={p.id} className="away-banner" style={{ '--c': p.color } as React.CSSProperties}>
            <Avatar person={p} size="sm" away />
            <span><b>{p.name} is in {trip!.city}</b> · {prog.left === 0 ? 'home tonight' : `home ${weekdayName(trip!.endsOn)}`}</span>
            <Sleeps total={prog.total} done={prog.done} />
          </div>
        );
      })}
    </div>
  );
}

function IdleScreen({ board, now, onWake }: { board: Board; now: Date; onWake: () => void }) {
  const c = clock(board, now);
  const { minutes } = nowMinutes(board, now);
  const upcoming = itemsOn(board, board.today)
    .filter(i => !i.allDay && i.status === 'on' && i.minutes >= minutes)
    .slice(0, 4);
  const away = board.people.filter(p => activeTrip(board, p.id, board.today));
  return (
    <button className="idle" onClick={onWake} aria-label="Open the board">
      <div className="idle-main">
        <div className="idle-clock">{c.time}<span>{c.ampm}</span></div>
        <div className="idle-date">{weekdayName(board.today)}, {monthName(board.today)} {dayOfMonth(board.today)}</div>
        {board.weather && (
          <div className="idle-wx"><b>{board.weather.temperature}°</b> {board.weather.description} · high {board.weather.high}°, low {board.weather.low}°</div>
        )}
      </div>
      <div className="idle-side">
        <h2>Up next</h2>
        {upcoming.length === 0 && <div className="idle-up muted">Nothing else today</div>}
        {upcoming.map(i => {
          const p = personById(board, i.personIds[0]);
          return (
            <div key={i.key} className="idle-up">
              <span className="idle-time">{i.timeLabel.split('–')[0]}</span>
              {p && <Avatar person={p} size="sm" />}
              <span>{i.icon} {i.title}</span>
            </div>
          );
        })}
        {away.length > 0 && <>
          <h2>Away</h2>
          {away.map(p => {
            const trip = activeTrip(board, p.id, board.today)!;
            const prog = tripProgress(trip, board.today);
            return (
              <div key={p.id} className="idle-up" style={{ '--c': p.color } as React.CSSProperties}>
                <Avatar person={p} size="sm" away />
                <span>{p.name} is in {trip.city}</span>
                <Sleeps total={prog.total} done={prog.done} />
              </div>
            );
          })}
        </>}
      </div>
      <div className="idle-hint">Tap anywhere to open the board</div>
    </button>
  );
}

/** Keeps the screen on while the board is visible, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState === 'visible' && nav.wakeLock) lock = await nav.wakeLock.request('screen');
      } catch { /* not allowed; the device's own sleep settings apply */ }
    };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => { document.removeEventListener('visibilitychange', request); void lock?.release(); };
  }, []);
}

export function Wall({ board, stale, loadedAt }: { board: Board; stale: boolean; loadedAt: Date | null }) {
  const now = useNow(15_000);
  const [view, setView] = useState<View>('today');
  const [idle, setIdle] = useState(false);
  const lastTouch = useRef(Date.now());
  useWakeLock();

  // Go idle after a few minutes without a touch.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const id = window.setInterval(() => {
      if (Date.now() - lastTouch.current > board.settings.idleMinutes * 60_000) { setIdle(true); setView('today'); }
    }, 10_000);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); window.clearInterval(id); };
  }, [board.settings.idleMinutes]);

  // Reload once a night to clear any memory build-up on an always-on screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      const { minutes } = nowMinutes(board, new Date());
      if (minutes === 3 * 60 + 30) window.location.reload();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [board]);

  const dim = isDimTime(board, now);
  const c = clock(board, now);

  return (
    <div className={`wall${dim ? ' dim' : ''}`}>
      <header className="topbar">
        <div>
          <div className="date-big">{weekdayName(board.today)}, {monthName(board.today, true)} {dayOfMonth(board.today)}</div>
          <div className="date-sub">{c.full}</div>
        </div>
        <AwayBanners board={board} />
        <div className="topbar-right">
          {board.weather && (
            <div className="weather">
              <div className="wx-t">{board.weather.temperature}°</div>
              <div className="wx-d">{board.weather.description} · high {board.weather.high}°</div>
            </div>
          )}
        </div>
      </header>

      {(stale || board.hasDemoData) && (
        <div className="notices">
          {stale && <span className="notice warn">Can’t reach the server. Showing what it had at {loadedAt ? loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'last load'}.</span>}
          {board.hasDemoData && <span className="notice">Showing sample data. Remove it in Settings on your phone.</span>}
        </div>
      )}

      <main className="wall-view">
        {view === 'today' && <TodayView board={board} now={now} />}
        {view === 'week' && <WeekView board={board} />}
        {view === 'kids' && <KidsView board={board} />}
      </main>

      <nav className="dock" aria-label="Board views">
        {(['today', 'week', 'kids'] as View[]).map(v => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'today' ? 'Today' : v === 'week' ? 'Week' : 'Kids'}
          </button>
        ))}
        <span className="dock-sep" />
        <button onClick={() => setIdle(true)}>Clock</button>
        <a className="dock-link" href="#/activities">Activities</a>
        <a className="dock-link" href="#/settings">Settings</a>
      </nav>

      {idle && <IdleScreen board={board} now={now} onWake={() => { lastTouch.current = Date.now(); setIdle(false); }} />}
    </div>
  );
}
