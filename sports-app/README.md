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

## Notifications: one-time setup

You need a free Cloudflare account. These steps run on any Linux box with Docker over SSH (they were
written for ZimaOS), so nothing is installed on the host; everything runs in a throwaway `node:22` container.

**1. Create a Cloudflare API token** (on any computer with a browser). `wrangler login` needs a browser
on the same machine, so over SSH use a token instead:

- dash.cloudflare.com → profile icon → **My Profile → API Tokens → Create Token**
- Use the **Edit Cloudflare Workers** template. Account Resources: your account. Zone Resources: **All zones**
  (nothing zone-specific is touched). **Continue → Create Token**, and copy it.
- Also copy your **Account ID** (Workers & Pages → Overview, right-hand side).

**2. SSH in and start a container.** `/DATA` is ZimaOS's persistent storage, and the keys are kept there.

```sh
ssh <user>@<zima-ip>
mkdir -p /DATA/scores && chmod 700 /DATA/scores
docker run -it --rm -v /DATA/scores:/work -w /work node:22 bash
```

**3. Inside the container:**

```sh
export CLOUDFLARE_API_TOKEN='paste-token'
export CLOUDFLARE_ACCOUNT_ID='paste-account-id'

git clone -b sports-app https://github.com/troylairson/catchall.git   # private repo: use a GitHub token as the password
cd catchall/sports-app/worker
npm ci

# Generate the Web Push keys ONCE and keep them; new keys break existing subscriptions.
[ -f /work/vapid.env ] || npm run --silent vapid -- --env > /work/vapid.env
chmod 600 /work/vapid.env && . /work/vapid.env

npx wrangler deploy        # first run may ask you to pick a workers.dev subdomain; prints the Worker URL
printf '%s' "$VAPID_PUBLIC_KEY"  | npx wrangler secret put VAPID_PUBLIC_KEY
printf '%s' "$VAPID_PRIVATE_KEY" | npx wrangler secret put VAPID_PRIVATE_KEY
printf '%s' 'mailto:you@example.com' | npx wrangler secret put VAPID_SUBJECT   # any address you read

curl -s https://scores.<your-subdomain>.workers.dev/api/vapid     # should print your public key
exit
```

**4. On your iPhone,** open Scores **from the Home Screen icon** (iOS only allows notifications there), tap
the gear, paste the Worker URL into *Scores server URL*, tap **Turn on**, then **Send a test notification**.

**Updating the server later:**

```sh
docker run -it --rm -v /DATA/scores:/work -w /work/catchall/sports-app/worker \
  -e CLOUDFLARE_API_TOKEN='paste-token' -e CLOUDFLARE_ACCOUNT_ID='paste-account-id' \
  node:22 bash -c 'git pull && npm ci && npx wrangler deploy'
```

Secrets stay on Cloudflare, so they don't need setting again. The Worker uses one Durable Object for state,
which fits in Cloudflare's free plan. `/api/status` on the Worker shows how many devices are subscribed and
when it last checked. To change who may call it, edit `ALLOWED_ORIGINS` in `wrangler.toml`.

## Develop

```sh
cd sports-app
npm install
npm run dev     # http://localhost:5174/catchall/sports/
npm test
npm run build
npm run catalog   # regenerate src/catalog.json (all teams) after relocations/renames

cd worker && npm install && npm test   # server: push encryption round trip
npx wrangler dev                        # run the server locally (put the three VAPID_* values in worker/.dev.vars)
```

Deployed by `.github/workflows/pages.yml` together with the guitar coach.
