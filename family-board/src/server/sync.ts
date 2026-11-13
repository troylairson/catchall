/** Keeps synced copies of iCloud calendars in the database. Each sync covers two weeks
 *  back to four months ahead, and skips calendars whose change tag hasn't moved. */

import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { Secrets } from './secrets';
import { ICLOUD_CALDAV_URL, connectCalDav, friendlyError, type Connect } from './caldav';
import { parseIcs } from './ics';
import { assignPeople } from '../shared/assign';
import { addDays, toZoned } from '../shared/dates';
import type { CalendarAccount } from '../shared/types';

const FAMILY_NAME = /\b(family|shared|kids|household)\b/i;

export interface SyncOptions {
  serverUrl?: string;
  connect?: Connect;
  now?: () => Date;
  /** Called after a sync that changed something, so screens refresh. */
  onChange?: () => void;
}

export class CalendarSync {
  private readonly serverUrl: string;
  private readonly connect: Connect;
  private readonly now: () => Date;
  private readonly onChange: () => void;
  private running = new Map<string, Promise<void>>();

  constructor(private readonly store: Store, private readonly secrets: Secrets, opts: SyncOptions = {}) {
    this.serverUrl = opts.serverUrl ?? ICLOUD_CALDAV_URL;
    this.connect = opts.connect ?? connectCalDav;
    this.now = opts.now ?? (() => new Date());
    this.onChange = opts.onChange ?? (() => {});
  }

  /** Checks the password by listing calendars, then saves the account and syncs it. */
  async addAccount(input: { personId: string; username: string; password: string }): Promise<CalendarAccount> {
    const username = input.username.trim();
    const password = input.password.replace(/\s+/g, '');
    try {
      await (await this.connect(this.serverUrl, username, password)).listCalendars();
    } catch (err) {
      throw new Error(friendlyError(err));
    }
    const existing = this.store.accounts().find(a => a.username.toLowerCase() === username.toLowerCase());
    const account = {
      id: existing?.id ?? randomUUID(), kind: 'icloud' as const, personId: input.personId, username,
      passwordEnc: this.secrets.encrypt(password), lastSyncedAt: null, lastError: null,
    };
    this.store.saveAccount(account);
    await this.syncAccount(account.id, { force: true });
    const { passwordEnc: _omit, ...pub } = this.store.account(account.id)!;
    return pub;
  }

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

  private async doSync(accountId: string, { force = false }: { force?: boolean }): Promise<void> {
    const account = this.store.account(accountId);
    if (!account) return;
    const settings = this.store.settings();
    const stamp = () => this.now().toISOString();
    let changed = false;

    try {
      const client = await this.connect(this.serverUrl, account.username, this.secrets.decrypt(account.passwordEnc));
      const remote = await client.listCalendars();
      const known = this.store.calendarSources(accountId);

      // Calendars removed in iCloud disappear here too.
      for (const c of known) {
        if (!remote.some(r => r.url === c.url)) { this.store.deleteSource(c.id); changed = true; }
      }

      const { from, to } = this.window();
      const people = this.store.people();
      for (const r of remote) {
        let source = known.find(c => c.url === r.url);
        if (!source) {
          source = {
            id: randomUUID(), accountId, url: r.url, name: r.name, color: r.color, enabled: true,
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
          const files = await client.fetchIcs(r.url, new Date(`${from}T00:00:00Z`), new Date(`${addDays(to, 1)}T00:00:00Z`));
          const events = files.flatMap(ics => parseIcs(ics, from, to, settings.timezone)).map(e => ({
            calendarId: source!.id, title: e.title, allDay: e.allDay, start: e.start, end: e.end,
            location: e.location, notes: e.notes, externalUid: e.uid,
            personIds: assignPeople(e.title, source!.personId, people), demo: false,
          }));
          this.store.replaceCalendarEvents(source.id, events);
          this.store.saveSource({ ...source, ctag: r.ctag, syncedFrom: from, lastSyncedAt: stamp(), lastError: null });
          changed = true;
        } catch (err) {
          this.store.saveSource({ ...source, lastError: friendlyError(err) });
          changed = true;
        }
      }
      this.store.updateAccountStatus(accountId, { lastSyncedAt: stamp(), lastError: null });
      if (account.lastError) changed = true;
    } catch (err) {
      this.store.updateAccountStatus(accountId, { lastError: friendlyError(err) });
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
