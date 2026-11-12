# Scores

A personal scores PWA for four teams: Steelers (NFL), Penguins (NHL), Cavaliers (NBA) and Guardians (MLB).
Live at https://troylairson.github.io/catchall/sports/

## Add it to your iPhone

Open the link in **Safari** → Share → **Add to Home Screen**. It opens full-screen like an app, follows the
system light/dark setting, and shows the last data it loaded when you're offline.

## What it does

- One card per team: the live score, or the last result plus the next game (times in Eastern).
- Live games float to the top. While any game is live (or within 15 minutes of starting) it refreshes every
  20 seconds; otherwise every 5 minutes. Polling pauses when the app is in the background.
- Offseason: shows the last result and the next real game, e.g. **Opening Day** for the Guardians, with
  "Spring training starts …" underneath.
- Tap a card for play-by-play of the live (or most recent) game.

## Data sources (free, no key)

| Team | Scores and schedule | Play-by-play |
| --- | --- | --- |
| Steelers | ESPN `football/nfl` team schedule + scoreboard | ESPN summary (drives) |
| Penguins | NHL `api-web.nhle.com` via proxy, otherwise ESPN `hockey/nhl` | NHL play-by-play via proxy, otherwise ESPN plays |
| Cavaliers | ESPN `basketball/nba` team schedule + scoreboard | ESPN summary (plays) |
| Guardians | MLB `statsapi.mlb.com` schedule | MLB `feed/live` (pitch by pitch) |

### Why the NHL proxy

`api-web.nhle.com` doesn't send CORS headers, so a web page can't call it directly. Out of the box the app
uses ESPN's NHL feed instead. To use the NHL's own feed (shot types, shots on goal, strength), deploy
`proxy/nhl-proxy.js` as a free Cloudflare Worker and paste its URL into Settings (gear icon). In
`npm run dev`, Vite proxies `/nhl-api` to the NHL so the native feed is used automatically.

## Develop

```sh
cd sports-app
npm install
npm run dev     # http://localhost:5174/catchall/sports/
npm test
npm run build
```

Deployed by `.github/workflows/pages.yml` together with the guitar coach.
