import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../api/http';
import type { Prefs } from '../alerts';
import { currentSubscription, disablePush, enablePush, loadPrefs, pushSupport, syncPush, testPush } from '../push';

const PREF_LABELS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'start', label: 'Game starting', hint: 'When one of your teams’ games begins' },
  { key: 'score', label: 'Scoring', hint: 'Every score (NBA: halftime and close finishes)' },
  { key: 'final', label: 'Final score', hint: 'When the game ends' },
];

export function SettingsSheet({ onClose }: { onClose: (changed: boolean) => void }) {
  const initial = loadSettings();
  const [server, setServer] = useState(initial.nhlProxy);
  const [on, setOn] = useState<boolean>();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>();
  const support = pushSupport();
  const serverChanged = server.trim().replace(/\/+$/, '') !== initial.nhlProxy;

  useEffect(() => {
    currentSubscription().then((s) => setOn(!!s));
  }, []);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
      if (ok) setMsg({ text: ok });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const saveServer = () => saveSettings({ ...initial, nhlProxy: server.trim().replace(/\/+$/, '') });

  return (
    <div className="sheet-backdrop" onClick={() => onClose(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h2>Settings</h2>

        <label className="field">
          <span>Scores server URL</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://scores.example.workers.dev"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
        </label>
        <p className="muted small">
          Your Cloudflare Worker from <code>sports-app/worker/</code>. It sends score notifications and lets the app use
          the NHL’s own feed. Without it, everything else still works.
        </p>

        <h3 className="sheet-sub">Notifications</h3>
        {support === 'install-first' && (
          <p className="muted small">
            On iPhone, notifications work only from the Home Screen app: tap Share → Add to Home Screen, then open Scores
            from there.
          </p>
        )}
        {support === 'unsupported' && <p className="muted small">This browser doesn’t support web notifications.</p>}
        {support === 'ok' && (
          <>
            <div className="toggle-row">
              <span>{on ? 'On for your teams' : 'Off'}</span>
              <button
                className={`btn small-btn ${on ? 'ghost' : ''}`}
                disabled={busy || on === undefined || (!on && !server.trim())}
                onClick={() =>
                  run(async () => {
                    if (on) {
                      await disablePush();
                      setOn(false);
                    } else {
                      if (serverChanged) saveServer();
                      await enablePush(prefs);
                      setOn(true);
                    }
                  }, on ? 'Notifications turned off.' : 'Notifications are on.')
                }
              >
                {on ? 'Turn off' : 'Turn on'}
              </button>
            </div>
            {!on && !server.trim() && <p className="muted small">Add the server URL above first.</p>}
            {on && (
              <>
                {PREF_LABELS.map(({ key, label, hint }) => (
                  <label key={key} className="toggle-row">
                    <span>
                      {label}
                      <span className="muted small block">{hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={prefs[key]}
                      disabled={busy}
                      onChange={(e) => {
                        const next = { ...prefs, [key]: e.target.checked };
                        setPrefs(next);
                        run(() => syncPush(next));
                      }}
                    />
                  </label>
                ))}
                <button className="btn ghost small-btn" disabled={busy} onClick={() => run(testPush, 'Test sent. It should arrive in a few seconds.')}>
                  Send a test notification
                </button>
              </>
            )}
          </>
        )}
        {msg && <p className={`small ${msg.error ? 'error' : 'muted'}`}>{msg.text}</p>}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              if (serverChanged) saveServer();
              onClose(serverChanged);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
