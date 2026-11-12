# Scores

A personal scores PWA for your favorite NFL, NHL, NBA and MLB teams (starts with the Steelers, Penguins,
Cavaliers and Guardians).
Live at https://troylairson.github.io/catchall/sports/

## Add it to your iPhone

Open the link in **Safari** → Share → **Add to Home Screen**. It opens full-screen like an app, follows the
system light/dark setting, and shows the last data it loaded when you're offline.

## What it does

- **My teams:** tap *Edit teams* to add any NFL, NHL, NBA or MLB team, remove teams, or reorder them.
  Favorites are saved on the device.
- One card per team: the live score, or the last result plus the next game (times in Eastern).
- Live games float to the top. While any game is live (or within 15 minutes of starting) it refreshes every
  20 seconds; otherwise every 5 minutes. Polling pauses when the app is in the background.
- Offseason: shows the last result and the next real game, e.g. **Opening Day** for the Guardians, with
  "Spring training starts …" underneath.
- Tap a card for play-by-play of the live (or most recent) game.

## Data sources (free, no key)

| League | Scores and schedule | Play-by-play |
| --- | --- | --- |
| NFL teams | ESPN `football/nfl` team schedule + scoreboard | ESPN summary (drives) |
| NHL teams | NHL `api-web.nhle.com` via the server, otherwise ESPN `hockey/nhl` | NHL play-by-play via the server, otherwise ESPN plays |
| NBA teams | ESPN `basketball/nba` team schedule + scoreboard | ESPN summary (plays) |
| MLB teams | MLB `statsapi.mlb.com` schedule | MLB `feed/live` (pitch by pitch) |

### Why a server

Two things can't be done from a web page alone, so there's a small Cloudflare Worker in `worker/`:

- **Notifications.** iPhone web apps can't check scores in the background, so the Worker checks your teams every
  minute while a game is live (every 10 minutes otherwise) and sends Web Push alerts: game starting, every score
  (NBA: halftime and close finishes instead of every basket) and the final. Each can be switched off.
- **NHL feed.** `api-web.nhle.com` sends no CORS headers. Without the server the app uses ESPN's NHL feed; with
  it, the Penguins (and any NHL team) use the NHL's own play-by-play.

Everything else works without it.

## Notifications: one-time setup (about 10 minutes)

You need a free Cloudflare account and Node 20+ on your computer.

```sh
cd sports-app/worker
npm install
npx wrangler login                     # opens a browser to sign in to Cloudflare
npm run vapid                          # prints a key pair for Web Push
```

1. Paste the printed **public** key into `wrangler.toml` as `VAPID_PUBLIC_KEY`.
2. Store the private key and a contact address as secrets:
   ```sh
   npx wrangler secret put VAPID_PRIVATE_KEY    # paste the private key
   npx wrangler secret put VAPID_SUBJECT        # e.g. mailto:you@example.com (push services require one)
   ```
3. Deploy: `npm run deploy`. Wrangler prints a URL like `https://scores.<you>.workers.dev`.
4. On your iPhone, open Scores **from the Home Screen** (iOS only allows notifications there), tap the gear, paste
   that URL into *Scores server URL*, and tap **Turn on**. Then **Send a test notification**.

The Worker uses one Durable Object for state, which fits in Cloudflare's free plan. `/api/status` on the
Worker shows how many devices are subscribed and when it last checked. To change who may call it, edit
`ALLOWED_ORIGINS` in `wrangler.toml`.

## Develop

```sh
cd sports-app
npm install
npm run dev     # http://localhost:5174/catchall/sports/
npm test
npm run build
npm run catalog   # regenerate src/catalog.json (all teams) after relocations/renames

cd worker && npm install && npm test   # server: push encryption round trip
npx wrangler dev                        # run the server locally (put VAPID keys in worker/.dev.vars)
```

Deployed by `.github/workflows/pages.yml` together with the guitar coach.
