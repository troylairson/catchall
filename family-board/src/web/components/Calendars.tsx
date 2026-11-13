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
          <div className="account-name">{owner?.name ?? 'Someone'}’s iCloud</div>
          <div className="muted small">{account.username}</div>
        </div>
        <button disabled={busy} onClick={() => act(() => api('POST', `/api/calendar-accounts/${account.id}/sync`))}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {account.lastError
        ? <p className="status error">{account.lastError}</p>
        : <p className="hint">Synced {ago(account.lastSyncedAt)}. Checks for changes every 10 minutes.</p>}
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
            <span>Disconnect {account.username}? Its events leave the board. Nothing changes in iCloud.</span>
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
      <h3 className="span-all">Connect an iCloud account</h3>
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

export function CalendarsCard({ board }: { board: Board }) {
  const [data, setData] = useState<CalendarsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<CalendarsData>('GET', '/api/calendars').then(setData).catch((e: Error) => setError(e.message));
  }, [board]);

  return (
    <section className="card" id="calendars">
      <h2>Calendars</h2>
      <p className="hint">
        The board reads your iCloud calendars; it never changes them. Personal calendars go to their owner’s column.
        Events on a Family calendar go to whoever the title names (“Lincoln dentist”), or to the Family row.
      </p>
      {error && <p className="status error">{error}</p>}
      {data?.accounts.map(a => (
        <AccountBlock key={a.id} board={board} account={a}
          calendars={data.calendars.filter(c => c.accountId === a.id)} onChange={setData}
          patchLocal={(id, patch) => setData(d => d && { ...d, calendars: d.calendars.map(c => (c.id === id ? { ...c, ...patch } : c)) })} />
      ))}
      {data && <ConnectForm board={board} onDone={setData} />}
    </section>
  );
}
