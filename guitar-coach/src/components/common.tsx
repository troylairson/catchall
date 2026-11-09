import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';
import { settings } from '../state/settings';

export function useEngineStatus() {
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.status,
  );
}

/** Calls fn on every animation frame while mounted. */
export function useFrame(fn: (t: number) => void, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** Re-render at a fixed rate (for meters/readouts). */
export function useTicker(ms = 50) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Shows a "start listening" button until the mic is on. */
export function MicGate({ children, why = 'so I can hear your guitar' }: { children: ReactNode; why?: string }) {
  const status = useEngineStatus();
  if (status === 'on') return <>{children}</>;
  return (
    <div className="card center">
      <p className="big">I need to listen {why}.</p>
      <button className="btn primary" onClick={() => engine.start()} disabled={status === 'starting'}>
        {status === 'starting' ? 'Starting…' : '🎤 Start listening'}
      </button>
      {status === 'error' && <p className="bad-text">{engine.error}</p>}
      <p className="muted">Chrome will ask to use your microphone — choose “Allow”.</p>
    </div>
  );
}

/** Horizontal input level meter with the strum gate marked. */
export function LevelMeter({ band = false, showGate = true }: { band?: boolean; showGate?: boolean }) {
  useTicker(50);
  const s = settings.get();
  const db = band ? engine.levels.bandDb : engine.levels.rawDb;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v + 80) / 80) * 100));
  return (
    <div className="meter" title={`${db.toFixed(0)} dB`}>
      <div className="meter-fill" style={{ width: `${pct(db)}%`, background: db > -3 ? 'var(--bad)' : undefined }} />
      {showGate && <div className="meter-gate" style={{ left: `${pct(s.onsetGateDb)}%` }} title="strum gate" />}
    </div>
  );
}

export function Tips({ tips }: { tips: { problem: string; fix: string }[] }) {
  if (!tips.length) return null;
  return (
    <ul className="tips">
      {tips.map((t, i) => (
        <li key={i}>
          <strong>{t.problem}</strong>
          <span>
            <b>Try this:</b> {t.fix}
          </span>
        </li>
      ))}
    </ul>
  );
}
