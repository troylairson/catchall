import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store';
import { seedIfEmpty } from './seed';
import { createApp } from './app';
import { scheduleBackups } from './backup';

const dataDir = process.env.DATA_DIR ?? '.data';
const webDir = process.env.WEB_DIR ?? 'dist/web';
const port = Number(process.env.PORT ?? 8710);

mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'family-board.db'));
seedIfEmpty(store);
scheduleBackups(store, process.env.BACKUP_DIR ?? join(dataDir, 'backups'));

const app = createApp({ store, weather: process.env.WEATHER !== '0' });
app.use('/*', serveStatic({ root: webDir }));
app.get('*', serveStatic({ path: join(webDir, 'index.html') }));

serve({ fetch: app.fetch, port }, info => {
  console.log(`Family Board on http://localhost:${info.port} (data in ${dataDir})`);
});
