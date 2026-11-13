/** Keeps synced copies of iCloud and Google calendars in the database. Each sync
 *  covers two weeks back to four months ahead. iCloud calendars whose change tag hasn't
 *  moved are skipped; Google calendars are re-read each time. */

import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { Secrets } from './secrets';
import { ICLOUD_CALDAV_URL, connectCalDav, friendlyError, type Connect } from './caldav';
import { GoogleAuth, googleError, googleSession, type FetchFn, type GoogleClient } from './google';
import { parseIcs } from './ics';
import type { ProviderSession } from './providers';
import { assignPeople } from '../shared/assign';
import { addDays, toZoned } from '../shared/dates';
import type { CalendarAccount } from '../shared/types';

const FAMILY_NAME = /\b(family|shared|kids|household)\b/i;

type StoredAccount = CalendarAccount & { passwordEnc: string };

export interface SyncOptions {
  serverUrl?: string;
  connect?: Connect;
  /** fetch for Google requests; replaceable in tests. */
  googleFetch?: FetchFn;
  now?: () => Date;
  /** Called after a sync that changed something, so screens refresh. */
  onChange?: () => void;
}

export class CalendarSync {
  private readonly serverUrl: string;
  private readonly connect: Connect;
  private readonly googleFetch: FetchFn;
  readonly google: GoogleAuth;
  private readonly now: () => Date;
  private readonly onChange: () => void;
  private running = new Map<string, Promise<void>>();

  constructor(private readonly store: Store, private readonly secrets: Secrets, opts: SyncOptions = {}) {
    this.serverUrl = opts.serverUrl ?? ICLOUD_CALDAV_URL;
    this.connect = opts.connect ?? connectCalDav;
    this.googleFetch = opts.googleFetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.google = new GoogleAuth(this.googleFetch, () => this.now().getTime());
    this.onChange = opts.onChange ?? (() => {});
  }

  // ---------- Google client settings ----------

  googleClient(): GoogleClient | null {
    const raw = this.store.getMeta('googleClient');
    if (!raw) return null;
    const { clientId, secretEnc } = JSON.parse(raw) as { clientId: string; secretEnc: string };
    return { clientId, clientSecret: this.secrets.decrypt(secretEnc) };
  }

  saveGoogleClient(clientId: string, clientSecret: string): void {
    this.store.setMeta('googleClient', JSON.stringify({ clientId: clientId.trim(), secretEnc: this.secrets.encrypt(clientSecret.trim()) }));
  }

  private requireGoogleClient(): GoogleClient {
    const client = this.googleClient();
    if (!client) throw new Error('Set up Google first: add the client ID and secret under Settings → Calendars.');
    return client;
  }

  startGoogleSignIn(personId: string): string {
    return this.google.start(this.requireGoogleClient(), personId);
  }

  /** Finishes a Google sign-in from the address pasted after Google's redirect. */
  async finishGoogleSignIn(pasted: string): Promise<CalendarAccount> {
    const client = this.requireGoogleClient();
    let personId: string, refreshToken: string, email: string;
    try {
      const tokens = await this.google.finish(client, pasted);
      ({ personId, refreshToken } = tokens);
      email = await googleSession(tokens.accessToken, this.googleFetch).primaryEmail();
    } catch (err) {
      console.warn(`Google sign-in failed: ${(err as Error)?.message ?? err}`);
      const e = err as { code?: string; message?: string };
      throw new Error(['denied', 'bad_paste', 'stale', 'no_refresh'].includes(e.code ?? '') ? String(e.message) : googleError(err));
    }
    return this.saveAccount('google', personId, email, refreshToken);
  }

  // ---------- iCloud ----------

  /** Checks the password by listing calendars, then saves the account and syncs it. */
  async addAccount(input: { personId: string; username: string; password: string }): Promise<CalendarAccount> {
    const username = input.username.trim();
    let password = input.password.replace(/\s+/g, '');
    // App-specific passwords are lowercase, but phone keyboards sometimes capitalize
    // the first letter.
    if (/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i.test(password)) password = password.toLowerCase();
    try {
      await (await this.connect(this.serverUrl, username, password)).listCalendars();
    } catch (err) {
      console.warn(`iCloud connect failed for ${username}: ${(err as Error)?.message ?? err}`);
      throw new Error(friendlyError(err));
    }
    return this.saveAccount('icloud', input.personId, username, password);
  }

  private async saveAccount(kind: 'icloud' | 'google', personId: string, username: string, secret: string): Promise<CalendarAccount> {
    const existing = this.store.accounts().find(a => a.kind === kind && a.username.toLowerCase() === username.toLowerCase());
    const account: StoredAccount = {
      id: existing?.id ?? randomUUID(), kind, personId, username,
      passwordEnc: this.secrets.encrypt(secret), lastSyncedAt: null, lastError: null,
    };
    this.store.saveAccount(account);
    await this.syncAccount(account.id, { force: true });
    const { passwordEnc: _omit, ...pub } = this.store.account(account.id)!;
    return pub;
  }

  // ---------- Sync ----------

  syncAll(opts: { force?: boolean } = {}): Promise<void[]> {
    return Promise.all(this.store.accounts().map(a => this.syncAccount(a.id, opts)));
  }

  /** One sync at a time per account; a second request waits for the first. */
  syncAccount(accountId: string, opts: { force?: boolean } = {}): Promise<void> {
    const current = this.running.get(accountId);
    if (current) return current;
    const job = this.doSync(accountId, opts).finally(() => this.running.delete(accountId));
    this.running.set(accountId, job);
    return job;
  }

  private window() {
    const today = toZoned(this.now(), this.store.settings().timezone).date;
    return { from: addDays(today, -14), to: addDays(today, 120) };
  }

  private errorFor(account: StoredAccount, err: unknown): string {
    return account.kind === 'google' ? googleError(err) : friendlyError(err);
  }

  private async open(account: StoredAccount): Promise<ProviderSession> {
    const secret = this.secrets.decrypt(account.passwordEnc);
    if (account.kind === 'google') {
      const token = await this.google.accessToken(this.requireGoogleClient(), secret);
      return googleSession(token, this.googleFetch);
    }
    const client = await this.connect(this.serverUrl, account.username, secret);
    return {
      listCalendars: () => client.listCalendars(),
      fetchEvents: async (url, from, to, tz) => {
        const files = await client.fetchIcs(url, new Date(`${from}T00:00:00Z`), new Date(`${addDays(to, 1)}T00:00:00Z`));
        return files.flatMap(ics => parseIcs(ics, from, to, tz));
      },
    };
  }

  private async doSync(accountId: string, { force = false }: { force?: boolean }): Promise<void> {
    const account = this.store.account(accountId);
    if (!account) return;
    const settings = this.store.settings();
    const stamp = () => this.now().toISOString();
    const label = account.kind === 'google' ? 'Google' : 'iCloud';
    let changed = false;

    try {
      const session = await this.open(account);
      const remote = await session.listCalendars();
      const known = this.store.calendarSources(accountId);

      // Calendars removed from the account disappear here too.
      for (const c of known) {
        if (!remote.some(r => r.url === c.url)) { this.store.deleteSource(c.id); changed = true; }
      }

      const { from, to } = this.window();
      const people = this.store.people();
      for (const r of remote) {
        let source = known.find(c => c.url === r.url);
        if (!source) {
          source = {
            id: randomUUID(), accountId, url: r.url, name: r.name, color: r.color,
            enabled: r.enabledByDefault ?? true,
            personId: FAMILY_NAME.test(r.name) ? null : account.personId,
            lastSyncedAt: null, lastError: null, ctag: null, syncedFrom: null,
          };
          changed = true;
        }
        source = { ...source, name: r.name, color: r.color };

        if (!source.enabled) {
          this.store.deleteCalendarEvents(source.id);
          this.store.saveSource({ ...source, ctag: null, syncedFrom: null });
          continue;
        }
        const unchanged = !force && r.ctag && source.ctag === r.ctag && source.syncedFrom === from;
        if (unchanged) {
          this.store.saveSource({ ...source, lastSyncedAt: stamp(), lastError: null });
          continue;
        }
        try {
          const events = (await session.fetchEvents(r.url, from, to, settings.timezone)).map(e => ({
            calendarId: source!.id, title: e.title, allDay: e.allDay, start: e.start, end: e.end,
            location: e.location, notes: e.notes, externalUid: e.uid,
            personIds: assignPeople(e.title, source!.personId, people), demo: false,
          }));
          this.store.replaceCalendarEvents(source.id, events);
          this.store.saveSource({ ...source, ctag: r.ctag, syncedFrom: from, lastSyncedAt: stamp(), lastError: null });
          changed = true;
        } catch (err) {
          console.warn(`${label} calendar “${r.name}” failed for ${account.username}: ${(err as Error)?.message ?? err}`);
          this.store.saveSource({ ...source, lastError: this.errorFor(account, err) });
          changed = true;
        }
      }
      this.store.updateAccountStatus(accountId, { lastSyncedAt: stamp(), lastError: null });
      if (account.lastError) changed = true;
    } catch (err) {
      console.warn(`${label} sync failed for ${account.username}: ${(err as Error)?.message ?? err}`);
      this.store.updateAccountStatus(accountId, { lastError: this.errorFor(account, err) });
      changed = true;
    }
    if (changed) this.onChange();
  }

  /** Re-assigns people on synced events after names, keywords or a calendar's owner change. */
  reassign(): void {
    const people = this.store.people();
    for (const source of this.store.calendarSources()) {
      const rows = this.store.eventsForCalendar(source.id);
      this.store.replaceCalendarEvents(source.id, rows.map(e => ({ ...e, personIds: assignPeople(e.title, source.personId, people) })));
    }
  }

  start(minutes: number): void {
    const tick = () => { void this.syncAll().catch(err => console.error('Calendar sync failed:', err)); };
    tick();
    setInterval(tick, minutes * 60_000).unref();
  }
}
