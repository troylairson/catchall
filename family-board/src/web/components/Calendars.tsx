import { useEffect, useState } from 'react';
import type { Board, CalendarAccount, CalendarSource } from '../../shared/types';
import { api } from '../api';
import { Avatar } from './Avatar';

interface CalendarsData { accounts: CalendarAccount[]; calendars: CalendarSource[] }

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr ago` : new Date(iso).toLocaleDateString();
}

function AccountBlock({ board, account, calendars, onChange, patchLocal }: {
  board: Board; account: CalendarAccount; calendars: CalendarSource[]; onChange: (d: CalendarsData) => void;
  /** Shows a change right away, before the server finishes syncing. */
  patchLocal: (id: string, patch: Partial<CalendarSource>) => void;
}) {
  const owner = board.people.find(p => p.id === account.personId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<CalendarsData>) => {
    setBusy(true);
    setError(null);
    try { onChange(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="account">
      <div className="account-head">
        {owner && <Avatar person={owner} size="sm" />}
        <div className="grow">
          <div className="account-name">{owner?.name ?? 'Someone'}’s {account.kind === 'google' ? 'Google' : 'iCloud'}</div>
          <div className="muted small">{account.username}</div>
        </div>
        <button disabled={busy} onClick={() => act(() => api('POST', `/api/calendar-accounts/${account.id}/sync`))}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {account.lastError
        ? <p className="status error">{account.lastError}</p>
        : <p className="hint">Synced {ago(account.lastSyncedAt)}. Checks for changes every 10 minutes.</p>}
      {account.lastError && account.kind === 'google' && /Connect this Google account again|stopped working/.test(account.lastError) && (
        <p className="hint">To reconnect, use “Add Google” below with the same account. Its calendar choices are kept.</p>
      )}
      {error && <p className="status error">{error}</p>}

      <ul className="cal-list">
        {calendars.map(c => (
          <li key={c.id} className={c.enabled ? '' : 'off'}>
            <label className="check grow">
              <input type="checkbox" checked={c.enabled}
                onChange={e => {
                  const enabled = e.target.checked;
                  patchLocal(c.id, { enabled });
                  void act(() => api('PUT', `/api/calendars/${c.id}`, { enabled }));
                }} />
              <span className="cal-dot" style={{ background: c.color || 'var(--muted)' }} />
              <span>{c.name}</span>
            </label>
            <label className="sr-only" htmlFor={`cal-${c.id}`}>Whose events are on {c.name}</label>
            <select id={`cal-${c.id}`} value={c.personId ?? ''} disabled={!c.enabled}
              onChange={e => {
                const personId = e.target.value || null;
                patchLocal(c.id, { personId });
                void act(() => api('PUT', `/api/calendars/${c.id}`, { personId }));
              }}>
              {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">Family (by names in titles)</option>
            </select>
            {c.lastError && <p className="status error span-all">{c.lastError}</p>}
          </li>
        ))}
        {calendars.length === 0 && <li className="muted">No calendars found in this account.</li>}
      </ul>

      {!confirm
        ? <button className="link-btn danger-link" onClick={() => setConfirm(true)}>Disconnect this account</button>
        : <div className="row wrap">
            <span>Disconnect {account.username}? Its events leave the board. Nothing changes in {account.kind === 'google' ? 'Google Calendar' : 'iCloud'}.</span>
            <button className="danger" onClick={() => act(() => api('DELETE', `/api/calendar-accounts/${account.id}`))}>Disconnect</button>
            <button onClick={() => setConfirm(false)}>Keep it</button>
          </div>}
    </div>
  );
}

function ConnectForm({ board, onDone }: { board: Board; onDone: (d: CalendarsData) => void }) {
  const parents = board.people.filter(p => p.role === 'parent');
  const [personId, setPersonId] = useState(parents[0]?.id ?? board.people[0]?.id ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="grid-form connect" onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        onDone(await api('POST', '/api/calendar-accounts', { personId, username, password }));
        setUsername('');
        setPassword('');
      } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      <h3 className="span-all">Add an iCloud account</h3>
      <ol className="steps span-all">
        <li>On appleid.apple.com, sign in and open <b>Sign-In and Security → App-Specific Passwords</b>.</li>
        <li>Create one named “Family Board” and copy it. It looks like <code>abcd-efgh-ijkl-mnop</code>.</li>
        <li>Enter it below. Your regular Apple ID password won’t work here.</li>
      </ol>
      <div className="field"><label htmlFor="ic-who">Whose account</label>
        <select id="ic-who" value={personId} onChange={e => setPersonId(e.target.value)}>
          {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="ic-user">Apple ID email</label>
        <input id="ic-user" type="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} /></div>
      <div className="field"><label htmlFor="ic-pass">App-specific password</label>
        <input id="ic-pass" type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={password} placeholder="abcd-efgh-ijkl-mnop" onChange={e => setPassword(e.target.value)} /></div>
      {error && <p className="status error span-all" role="alert">{error}</p>}
      <div className="row span-all">
        <button className="primary" disabled={busy}>{busy ? 'Connecting… (this can take a minute)' : 'Connect'}</button>
      </div>
    </form>
  );
}

interface GoogleConfig { configured: boolean; clientId: string }

/** One-time Google Cloud setup: the client ID and secret Family Board signs in with. */
function GoogleSetup({ config, onSaved, onCancel }: { config: GoogleConfig; onSaved: (c: GoogleConfig) => void; onCancel?: () => void }) {
  const [clientId, setClientId] = useState(config.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid-form connect" onSubmit={async e => {
      e.preventDefault();
      setError(null);
      try { onSaved(await api('PUT', '/api/google/config', { clientId, clientSecret })); } catch (err) { setError((err as Error).message); }
    }}>
      <h3 className="span-all">Google setup (once for the family)</h3>
      <ol className="steps span-all">
        <li>At console.cloud.google.com, create a project named “Family Board”.</li>
        <li>APIs &amp; Services → Library → <b>Google Calendar API</b> → Enable.</li>
        <li>Google Auth Platform → Get started: app name “Family Board”, your email, audience <b>External</b>.</li>
        <li>Audience → <b>Publish app</b>. Otherwise Google signs you out every 7 days.</li>
        <li>Clients → Create client → type <b>Desktop app</b>. Copy its client ID and secret below.</li>
      </ol>
      <div className="field span-all"><label htmlFor="g-id">Client ID</label>
        <input id="g-id" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={clientId} placeholder="1234-abc.apps.googleusercontent.com" onChange={e => setClientId(e.target.value)} /></div>
      <div className="field span-all"><label htmlFor="g-secret">Client secret</label>
        <input id="g-secret" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={clientSecret} onChange={e => setClientSecret(e.target.value)} /></div>
      {error && <p className="status error span-all" role="alert">{error}</p>}
      <div className="row span-all"><button className="primary">Save Google setup</button>{onCancel && <button type="button" onClick={onCancel}>Cancel</button>}</div>
    </form>
  );
}

function GoogleConnect({ board, onDone }: { board: Board; onDone: (d: CalendarsData) => void }) {
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const parents = board.people.filter(p => p.role === 'parent');
  const [personId, setPersonId] = useState(parents[0]?.id ?? board.people[0]?.id ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<GoogleConfig>('GET', '/api/google/config').then(setConfig).catch((e: Error) => setError(e.message)); }, []);

  if (!config) return error ? <p className="status error">{error}</p> : null;
  if (!config.configured || editing) {
    return <GoogleSetup config={config} onSaved={c => { setConfig(c); setEditing(false); }} onCancel={config.configured ? () => setEditing(false) : undefined} />;
  }

  return (
    <div className="grid-form connect">
      <h3 className="span-all">Add a Google account</h3>
      <div className="field"><label htmlFor="g-who">Whose account</label>
        <select id="g-who" value={personId} onChange={e => { setPersonId(e.target.value); setLink(null); }}>
          {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="row span-all wrap">
        {!link
          ? <button className="primary" onClick={async () => {
              setError(null);
              try { setLink((await api<{ url: string }>('POST', '/api/google/start', { personId })).url); } catch (err) { setError((err as Error).message); }
            }}>Sign in with Google</button>
          : <a className="button primary" href={link} target="_blank" rel="noopener noreferrer">Open Google sign-in</a>}
      </div>
      {link && (
        <form className="span-all grid-form" onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try { onDone(await api('POST', '/api/google/finish', { response: pasted })); setLink(null); setPasted(''); }
          catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>
          <ol className="steps span-all">
            <li>In the tab that opens, choose the account and allow access. If Google says the app isn’t verified, choose <b>Advanced → Go to Family Board</b>. It’s your own app.</li>
            <li>That tab then fails to load a page starting with <code>127.0.0.1:8710</code>. That’s expected.</li>
            <li>Copy the <b>whole address</b> from that tab’s address bar and paste it here.</li>
          </ol>
          <div className="field span-all"><label htmlFor="g-paste">Address from the failed tab</label>
            <input id="g-paste" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={pasted} placeholder="http://127.0.0.1:8710/?state=…&code=…" onChange={e => setPasted(e.target.value)} /></div>
          <div className="row span-all"><button className="primary" disabled={busy || !pasted.trim()}>{busy ? 'Connecting…' : 'Finish connecting'}</button></div>
        </form>
      )}
      {error && <p className="status error span-all" role="alert">{error}</p>}
      <button className="link-btn span-all" onClick={() => setEditing(true)}>Change the Google client ID or secret</button>
    </div>
  );
}

export function CalendarsCard({ board }: { board: Board }) {
  const [adding, setAdding] = useState<'icloud' | 'google' | null>(null);
  const [data, setData] = useState<CalendarsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<CalendarsData>('GET', '/api/calendars').then(setData).catch((e: Error) => setError(e.message));
  }, [board]);

  return (
    <section className="card" id="calendars">
      <h2>Calendars</h2>
      <p className="hint">
        The board reads your iCloud and Google calendars; it never changes them. An event whose title names someone
        (“Lincoln Chess”) goes to that person’s column, whichever calendar it’s on. Other events go to the calendar’s owner,
        or to the Family row for a Family calendar.
      </p>
      {error && <p className="status error">{error}</p>}
      {data?.accounts.map(a => (
        <AccountBlock key={a.id} board={board} account={a}
          calendars={data.calendars.filter(c => c.accountId === a.id)} onChange={setData}
          patchLocal={(id, patch) => setData(d => d && { ...d, calendars: d.calendars.map(c => (c.id === id ? { ...c, ...patch } : c)) })} />
      ))}
      {data && (
        <div className="row wrap add-row">
          <button aria-pressed={adding === 'icloud'} onClick={() => setAdding(adding === 'icloud' ? null : 'icloud')}>Add iCloud</button>
          <button aria-pressed={adding === 'google'} onClick={() => setAdding(adding === 'google' ? null : 'google')}>Add Google</button>
        </div>
      )}
      {data && adding === 'icloud' && <ConnectForm board={board} onDone={d => { setData(d); setAdding(null); }} />}
      {data && adding === 'google' && <GoogleConnect board={board} onDone={d => { setData(d); setAdding(null); }} />}
    </section>
  );
}
