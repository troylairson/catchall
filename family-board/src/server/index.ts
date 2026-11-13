import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store';
import { seedIfEmpty } from './seed';
import { ChangeBus, createApp } from './app';
import { scheduleBackups } from './backup';
import { Secrets } from './secrets';
import { CalendarSync } from './sync';

const dataDir = process.env.DATA_DIR ?? '.data';
const webDir = process.env.WEB_DIR ?? 'dist/web';
const port = Number(process.env.PORT ?? 8710);

mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'family-board.db'));
seedIfEmpty(store);
scheduleBackups(store, process.env.BACKUP_DIR ?? join(dataDir, 'backups'));

const bus = new ChangeBus();
const sync = new CalendarSync(store, Secrets.fromDataDir(dataDir), {
  serverUrl: process.env.CALDAV_URL,
  onChange: () => bus.emit(),
});
// Apply the current naming rules to events already synced (unchanged calendars aren't re-read).
sync.reassign();
sync.start(Number(process.env.SYNC_MINUTES ?? 10));

const app = createApp({ store, bus, sync, weather: process.env.WEATHER !== '0' });
app.use('/*', serveStatic({ root: webDir }));
app.get('*', serveStatic({ path: join(webDir, 'index.html') }));

serve({ fetch: app.fetch, port }, info => {
  console.log(`Family Board on http://localhost:${info.port} (data in ${dataDir})`);
});
