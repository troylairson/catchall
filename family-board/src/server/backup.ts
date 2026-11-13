import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './store';
import { toZoned } from '../shared/dates';

const KEEP = 14;

/** Writes a consistent copy of the database once a day (at 2 AM household time)
 *  and keeps the last two weeks. VACUUM INTO is safe while the app is running. */
export function scheduleBackups(store: Store, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const run = () => {
    const { date, minutes } = toZoned(new Date(), store.settings().timezone);
    if (minutes < 120) return;
    const file = join(dir, `family-board-${date}.db`);
    const existing = readdirSync(dir).filter(f => /^family-board-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    if (existing.includes(`family-board-${date}.db`)) return;
    try {
      store.db.prepare('VACUUM INTO :file').run({ file });
      console.log(`Backup written to ${file}`);
      for (const old of [...existing, `family-board-${date}.db`].sort().slice(0, -KEEP)) rmSync(join(dir, old));
    } catch (err) {
      console.error('Backup failed:', (err as Error).message);
    }
  };
  run();
  setInterval(run, 15 * 60_000).unref();
}
