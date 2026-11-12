import { useState } from 'react';
import { loadSettings, saveSettings } from '../api/http';

export function SettingsSheet({ onClose }: { onClose: (changed: boolean) => void }) {
  const initial = loadSettings();
  const [proxy, setProxy] = useState(initial.nhlProxy);
  const save = () => {
    const changed = proxy.trim() !== initial.nhlProxy;
    saveSettings({ ...initial, nhlProxy: proxy.trim() });
    onClose(changed);
  };
  return (
    <div className="sheet-backdrop" onClick={() => onClose(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <label className="field">
          <span>NHL proxy URL (optional)</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://nhl-proxy.example.workers.dev"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
        </label>
        <p className="muted small">
          The NHL’s own API doesn’t allow requests from web pages, so by default the Penguins card and shot feed come
          from ESPN. If you deploy the small proxy in <code>sports-app/proxy/</code>, paste its URL here to use the NHL feed
          (shots on goal, shot types, strength).
        </p>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button className="btn" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
