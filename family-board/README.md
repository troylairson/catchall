# Family Board

A family calendar for a wall display, with a phone view. It shows everyone's day in
their own color, answers "is today a chess club day?" for the kids, and shows when a
parent is traveling. See [PLAN.md](PLAN.md) for the design and roadmap.

**Status:** phases 1 and 2 are built: the wall display, the phone view, people and
colors, kid activities with school-calendar skips, one-time changes, snow days, trips,
and backups. Phase 3 has started: iCloud calendars sync (read-only). Google calendars
and automatic trip detection are next.

## Screens

| Address | What it shows |
|---|---|
| `/` on a wide screen | Wall display: Today, Week, Kids and an idle clock |
| `/` on a phone | Today's agenda, with day-by-day navigation and per-person filters |
| `/#/kids` | Yes or no for each kid activity today, with the next date |
| `/#/activities` | Add and edit activities; cancel, move or add a note to one date |
| `/#/settings` | Names, colors and emoji; calendars; snow days; trips; display settings; sample data |
| `/#/wall` | Forces the wall layout on any screen |

## Develop

Requires Node 22.5 or later (it uses the built-in `node:sqlite`).

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the API on port 8710.

```bash
npm test
```

```bash
npm run build && npm start
```

`npm start` serves the built app and API together on http://localhost:8710.

Environment variables: `PORT` (8710), `DATA_DIR` (`.data`), `BACKUP_DIR`
(`$DATA_DIR/backups`), `DEMO_DATA` (`0` skips sample data on first run), `WEATHER`
(`0` turns off weather requests), `SYNC_MINUTES` (10), `CALDAV_URL` (iCloud; point it
at another CalDAV server for testing), `SECRET_KEY` (base64, 32 bytes; otherwise a key
is generated into `$DATA_DIR/secret.key`).

## Connecting iCloud calendars

In Settings → Calendars, each person connects their Apple ID once with an
app-specific password (appleid.apple.com → Sign-In and Security → App-Specific
Passwords). The board lists the account's calendars, and for each you choose whether
to show it and whose column it goes to. A calendar named like "Family" or "Shared"
starts in the Family row, where events go to whoever the title names.

- The board only reads calendars. It never changes anything in iCloud.
- Passwords are encrypted with the key in `secret.key` in the data folder. Keep that
  file with the database. A restored database without its key can't sync until each
  account is connected again.
- The same event on two calendars (an invitation, or the shared calendar seen from
  both accounts) shows once, in every column it belongs to.
- If a sync fails or is over an hour old, the wall and phones show a notice.

## Install on ZimaOS

1. Merge to `main`. The **Family Board image** workflow tests the app and publishes
   `ghcr.io/troylairson/family-board` for amd64 and arm64.
2. The first time, make the package public (GitHub → your profile → Packages →
   family-board → Package settings → Change visibility), or run `docker login ghcr.io`
   on the ZimaOS box with a personal access token that can read packages.
3. In ZimaOS: App Store → Custom Install → Import, then paste
   [`docker-compose.yml`](docker-compose.yml). To start without sample data, change
   `DEMO_DATA` to `"0"` before installing.
4. Open `http://<zima-box>:8710` on the wall display, and on phones.

After that, every merge to `main` reaches the box overnight. The bundled Watchtower
container checks for a new image at 4 AM.

**Data and backups:** the database is `/DATA/AppData/family-board/family-board.db`. A
copy is written to `/DATA/Backup/family-board/` every night after 2 AM, and the last
14 are kept. To restore, stop the app, copy a backup over `family-board.db`, and
delete any `family-board.db-wal` and `family-board.db-shm` files next to it.

**Security:** there are no logins yet (QR pairing and phone sign-in are phase 4). Keep
port 8710 reachable only from your home network or Tailscale, and don't forward it
from your router.

## Layout

```
src/shared/   types, dates, colors, school calendar, recurrence engine (+ tests)
src/server/   Hono API, node:sqlite storage, sample data, weather, backups (+ tests)
src/web/      React app: wall views, phone views, settings, activity editor
data/         transcribed school calendars
```
