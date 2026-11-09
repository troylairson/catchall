import { useEffect, useRef, useState } from 'react';
import { engine, listInputs, Onset } from '../audio/engine';
import { beep, click, hat, kick } from '../audio/synth';
import { Fretboard, StringMark } from '../components/Fretboard';
import { LevelMeter, MicGate, useEngineStatus } from '../components/common';
import { foldedCents, OPEN_STRINGS, stringName } from '../music/notes';
import { settings } from '../state/settings';
import { progress } from '../state/progress';

type Stage = 'input' | 'quiet' | 'latency' | 'strings' | 'done';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'input', label: '1. Hear you' },
  { id: 'quiet', label: '2. Quiet room' },
  { id: 'latency', label: '3. Delay' },
  { id: 'strings', label: '4. Each string' },
  { id: 'done', label: 'Done' },
];

export function SetupCheck({ onDone }: { onDone?: () => void }) {
  const [stage, setStage] = useState<Stage>('input');
  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="page">
      <div className="stage-tabs">
        {STAGES.map((s, i) => (
          <span key={s.id} className={i === idx ? 'on' : i < idx ? 'done' : ''}>
            {s.label}
          </span>
        ))}
      </div>
      {stage === 'input' && <InputStage next={() => setStage('quiet')} />}
      {stage === 'quiet' && (
        <MicGate>
          <QuietStage next={() => setStage('latency')} />
        </MicGate>
      )}
      {stage === 'latency' && (
        <MicGate>
          <LatencyStage next={() => setStage('strings')} />
        </MicGate>
      )}
      {stage === 'strings' && (
        <MicGate>
          <StringsStage
            next={() => {
              progress.set({ setupDone: true });
              setStage('done');
            }}
          />
        </MicGate>
      )}
      {stage === 'done' && (
        <div className="card center">
          <div className="banner good">All set — I can hear your guitar clearly.</div>
          <p className="muted">
            Strum gate: {settings.get().onsetGateDb} dB · Delay: {settings.get().latencyMs} ms. You can redo this any time from the Setup tab.
          </p>
          {onDone ? (
            <button className="btn primary" onClick={onDone}>
              Continue
            </button>
          ) : (
            <a className="btn primary" href="#/">
              Back to lessons
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- 1. input ----------------

function InputStage({ next }: { next: () => void }) {
  const status = useEngineStatus();
  const s = settings.use();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mode, setMode] = useState<'mic' | 'usb'>(s.deviceId ? 'usb' : 'mic');
  const [peak, setPeak] = useState(-120);
  const [heardWell, setHeardWell] = useState(false);

  useEffect(() => {
    if (status === 'on') listInputs().then(setDevices);
  }, [status]);

  // track the loudest thing heard so we can tell them it's working
  useEffect(() => {
    const id = setInterval(() => {
      setPeak((p) => Math.max(p - 0.4, engine.levels.rawDb));
      if (engine.levels.rawDb > -30) setHeardWell(true);
    }, 50);
    return () => clearInterval(id);
  }, []);

  const pick = async (deviceId: string, channel = settings.get().channel) => {
    settings.set({ deviceId, channel });
    if (engine.status === 'on') await engine.restart();
  };

  return (
    <div className="card">
      <h2>How is your guitar getting to the laptop?</h2>
      <div className="two-col">
        <label className={`card ${mode === 'mic' ? 'sel-card' : ''}`}>
          <input
            type="radio"
            checked={mode === 'mic'}
            onChange={() => {
              setMode('mic');
              pick('', 'mix');
            }}
          />{' '}
          <b>Laptop microphone, near the amp</b>
          <p className="muted small">Easiest. Put the laptop about an arm’s length from the amp.</p>
        </label>
        <label className={`card ${mode === 'usb' ? 'sel-card' : ''}`}>
          <input type="radio" checked={mode === 'usb'} onChange={() => setMode('usb')} /> <b>USB audio interface</b>
          <p className="muted small">Guitar plugged into a little box connected by USB. Listen with headphones plugged into the box.</p>
        </label>
      </div>

      {status !== 'on' ? (
        <div className="center" style={{ marginTop: '1rem' }}>
          <button className="btn primary" onClick={() => engine.start()} disabled={status === 'starting'}>
            🎤 Start listening
          </button>
          {status === 'error' && <p className="bad-text">{engine.error}</p>}
        </div>
      ) : (
        <>
          {mode === 'usb' && (
            <div className="row gap wrap" style={{ margin: '1rem 0' }}>
              <select value={s.deviceId} onChange={(e) => pick(e.target.value)}>
                <option value="">Choose your interface…</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Input device'}
                  </option>
                ))}
              </select>
              <select value={s.channel} onChange={(e) => pick(s.deviceId, e.target.value as any)}>
                <option value="mix">Both inputs</option>
                <option value="left">Input 1 only</option>
                <option value="right">Input 2 only</option>
              </select>
            </div>
          )}
          <p className="big" style={{ marginTop: '1rem' }}>
            Now strum a few times. The bar should jump.
          </p>
          <LevelMeter showGate={false} />
          <p className="muted small">Listening on: {engine.deviceLabel}</p>
          {heardWell ? (
            <div className="banner good">I can hear you!</div>
          ) : peak > -50 ? (
            <p className="hint">I can hear something, but it’s quiet. Turn the amp up a little or move the laptop closer.</p>
          ) : (
            <p className="hint">
              Nothing yet. Check the amp is on and the guitar’s volume knob is turned up.
              {mode === 'usb' ? ' On an interface, try “Input 1 only” and turn up the input knob on the box.' : ''}
            </p>
          )}
          {peak > -3 && <p className="hint">That’s very loud — it may distort. Turn the amp (or interface knob) down a little.</p>}
          <div className="row gap" style={{ marginTop: '1rem' }}>
            <span className="spacer" />
            <button className="btn primary" onClick={next} disabled={!heardWell && peak < -50}>
              Sounds good — next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 2. quiet room ----------------

function QuietStage({ next }: { next: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'running' | 'result'>('ready');
  const [result, setResult] = useState<{ peak: number; gate: number } | null>(null);
  const [left, setLeft] = useState(0);

  const run = async () => {
    setPhase('running');
    const ctx = await engine.ensureContext();
    const s = settings.get();
    const t0 = ctx.currentTime + 0.3;
    const secs = 4;
    // play the same sounds the games make, to measure how much leaks into the mic
    for (let b = 0; b < secs * 2; b++) {
      const t = t0 + b * 0.5;
      click(ctx, engine.out, t, s.clickVolume, b % 4 === 0);
      hat(ctx, engine.out, t + 0.25, s.backingVolume * 0.3);
      if (b % 2 === 0) kick(ctx, engine.out, t, s.backingVolume);
    }
    let peak = -120;
    const start = performance.now();
    await new Promise<void>((res) => {
      const id = setInterval(() => {
        peak = Math.max(peak, engine.levels.bandDb);
        const el = (performance.now() - start) / 1000;
        setLeft(Math.max(0, Math.ceil(secs + 0.4 - el)));
        if (el > secs + 0.4) {
          clearInterval(id);
          res();
        }
      }, 40);
    });
    const gate = Math.round(Math.min(-20, Math.max(-70, peak + 8)));
    settings.set({ onsetGateDb: gate });
    engine.log(`Quiet check: background peak ${peak.toFixed(1)} dB → strum gate ${gate} dB`);
    setResult({ peak, gate });
    setPhase('result');
  };

  return (
    <div className="card">
      <h2>Quiet room check</h2>
      <p className="big">Rest your strumming hand flat on the strings so they can’t ring. I’ll play some clicks and measure the background noise.</p>
      {phase === 'ready' && (
        <button className="btn primary" onClick={run}>
          Strings are quiet — start
        </button>
      )}
      {phase === 'running' && <p className="big">Keep still… {left}</p>}
      {phase === 'result' && result && (
        <>
          {result.gate >= -25 ? (
            <p className="hint">
              It’s quite noisy here (or the laptop speakers are loud). Turn the laptop volume down a little, or use headphones for the clicks, then try again.
            </p>
          ) : (
            <div className="banner good">Nice and quiet. I’ll ignore anything quieter than your strums.</div>
          )}
          <div className="row gap" style={{ marginTop: '1rem' }}>
            <button className="btn" onClick={run}>
              Do it again
            </button>
            <span className="spacer" />
            <button className="btn primary" onClick={next}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 3. latency ----------------

export function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

function LatencyStage({ next }: { next: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'beeps' | 'strum' | 'result' | 'failed'>('ready');
  const [msg, setMsg] = useState('');
  const [count, setCount] = useState(0);

  const measure = async (kind: 'beeps' | 'strum') => {
    setPhase(kind);
    setCount(0);
    const ctx = await engine.ensureContext();
    const n = 8;
    const gap = kind === 'beeps' ? 0.6 : 0.75;
    const t0 = ctx.currentTime + (kind === 'beeps' ? 0.5 : 2 * gap);
    const times: number[] = [];
    if (kind === 'strum') for (let i = 2; i > 0; i--) click(ctx, engine.out, t0 - i * gap, settings.get().clickVolume, true);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * gap;
      times.push(t);
      if (kind === 'beeps') beep(ctx, engine.out, t, 0.7);
      else click(ctx, engine.out, t, settings.get().clickVolume, i % 4 === 0);
    }
    const onsets: Onset[] = [];
    const off = engine.onOnset((o) => {
      onsets.push(o);
      setCount((c) => c + 1);
    });
    await new Promise((r) => setTimeout(r, (t0 - ctx.currentTime + n * gap + 0.5) * 1000));
    off();

    // pair each beep with the first sound heard 0-450 ms after it
    const diffs: number[] = [];
    for (const t of times) {
      const o = onsets.find((x) => x.time - t > (kind === 'beeps' ? -0.03 : -0.25) && x.time - t < 0.45);
      if (o) diffs.push((o.time - t) * 1000);
    }
    engine.log(`Latency (${kind}): ${diffs.length}/${n} heard, offsets ${diffs.map((d) => d.toFixed(0)).join(', ')} ms`);
    if (diffs.length < 5) {
      setMsg(
        kind === 'beeps'
          ? `I only heard ${diffs.length} of the ${n} beeps. If you’re using headphones or an interface, the mic can’t hear the laptop — use “strum along” instead.`
          : `I only heard ${diffs.length} of your ${n} strums. Strum a little harder, then try again.`,
      );
      setPhase('failed');
      return;
    }
    const med = median(diffs);
    const spread = median(diffs.map((d) => Math.abs(d - med)));
    const latency = Math.round(med);
    settings.set({ latencyMs: latency });
    setMsg(
      `Delay measured: ${latency} ms${spread > 25 ? ' (a bit uneven — fine for now, you can redo it later)' : ''}. I’ll correct for it so your timing scores are fair.`,
    );
    setPhase('result');
  };

  const useEstimate = () => {
    const est = Math.round(engine.outputLatency() * 1000 + 15);
    settings.set({ latencyMs: est });
    engine.log(`Latency: using browser estimate ${est} ms`);
    next();
  };

  return (
    <div className="card">
      <h2>Measure the delay</h2>
      <p className="big">
        Every computer has a tiny delay between a sound happening and the app hearing it. Let’s measure yours so I don’t mark you late when you’re not.
      </p>
      {phase === 'ready' && (
        <>
          <p>Keep your strings quiet. I’ll play 8 beeps through the laptop speakers and listen for them.</p>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => measure('beeps')}>
              Play the beeps
            </button>
            <button className="btn" onClick={() => measure('strum')}>
              Using headphones? Strum along instead
            </button>
          </div>
        </>
      )}
      {phase === 'beeps' && <p className="big">Listening for beeps… ({count} heard)</p>}
      {phase === 'strum' && <p className="big">After 2 count-in clicks, strum the open strings on each click. ({count} heard)</p>}
      {(phase === 'result' || phase === 'failed') && (
        <>
          <p className={phase === 'failed' ? 'hint' : 'banner good'}>{msg}</p>
          <div className="row gap wrap" style={{ marginTop: '1rem' }}>
            <button className="btn" onClick={() => measure('beeps')}>
              Beeps again
            </button>
            <button className="btn" onClick={() => measure('strum')}>
              Strum along
            </button>
            <span className="spacer" />
            {phase === 'failed' && (
              <button className="btn ghost" onClick={useEstimate}>
                Skip (use a guess)
              </button>
            )}
            {phase === 'result' && (
              <button className="btn primary" onClick={next}>
                Next
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 4. each string ----------------

function StringsStage({ next }: { next: () => void }) {
  const [heard, setHeard] = useState<boolean[]>([false, false, false, false, false, false]);
  const [stuckFor, setStuckFor] = useState(0);
  const cur = heard.findIndex((h) => !h);
  const since = useRef(performance.now());
  const votes = useRef(0);

  useEffect(() => {
    since.current = performance.now();
    votes.current = 0;
    setStuckFor(0);
    if (cur < 0) return;
    const id = setInterval(() => {
      setStuckFor((performance.now() - since.current) / 1000);
      const p = engine.readPitch();
      if (!p || !p.hz) return;
      // a generous match: within 1.5 spaces of the right note, any octave (string may still be out of tune)
      if (Math.abs(foldedCents(p.hz, OPEN_STRINGS[cur])) < 150) {
        if (++votes.current >= 3) setHeard((h) => h.map((v, i) => (i === cur ? true : v)));
      } else votes.current = Math.max(0, votes.current - 1);
    }, 40);
    return () => clearInterval(id);
  }, [cur]);

  const marks: Partial<Record<number, StringMark>> = {};
  heard.forEach((h, i) => h && (marks[i] = 'ok'));
  if (cur >= 0) marks[cur] = 'active';

  return (
    <div className="card">
      <h2>Play each string once</h2>
      <p className="big">
        {cur >= 0 ? (
          <>
            Pick the <b>{stringName(cur)}</b> and let it ring. (It’s lit up below.)
          </>
        ) : (
          'I heard all six strings!'
        )}
      </p>
      <Fretboard marks={marks} spaces={3} />
      <div className="row wrap gap">
        {heard.map((h, i) => (
          <span key={i} className={`chip ${h ? 'ok' : ''} ${i === cur ? 'sel' : ''}`}>
            {h ? '✓ ' : ''}
            {stringName(i)}
          </span>
        ))}
      </div>
      {cur >= 0 && stuckFor > 10 && (
        <div className="hint" style={{ marginTop: '1rem' }}>
          I can’t pick out the {stringName(cur)} yet.{' '}
          {cur <= 1
            ? 'Thick strings are hard for laptop mics to hear. Fix: move the laptop closer to the amp, or turn up the amp’s bass knob a little.'
            : 'Fix: pick it a bit harder and let it ring, without touching it with your other hand.'}{' '}
          <button className="link" onClick={() => setHeard((h) => h.map((v, i) => (i === cur ? true : v)))}>
            Skip this string
          </button>
        </div>
      )}
      <div className="row" style={{ marginTop: '1rem' }}>
        <span className="spacer" />
        <button className="btn primary" disabled={cur >= 0} onClick={next}>
          Finish setup
        </button>
      </div>
    </div>
  );
}
