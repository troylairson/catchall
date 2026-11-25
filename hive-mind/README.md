# Hive Mind

An ad-free bee puzzle for the phone home screen. Tap a numbered swarm to move it
into the hive; its bees fly out one at a time and each grabs a block of its
color. Bees can only reach blocks on the outside edge of the picture, and the
hive holds 5 swarms, so the order you tap matters.

Live at https://troylairson.github.io/catchall/hive/. On iPhone, open it in
Safari and choose Share → Add to Home Screen.

## How it's built

Plain HTML/CSS/JS modules, no build step.

- `src/engine.js` — the rules (reachability, slots, ticks, win/jam), plus a
  replay checker, a solver and a "casual player" bot.
- `src/pictures.js` — procedural pixel pictures drawn from simple shapes,
  plus shading and speckles to add colors.
- `src/generator.js` — builds level N from a seed. It plays the picture
  forward to get a known winning order, deals it into columns (so every level
  is solvable), then rates it with the bot. Every 5th level is Hard and every
  10th is Super Hard (more colors, swarms that must wait, linked pairs, and
  hidden "?" swarms).
- `src/main.js` — canvas rendering, bees, input, screens.
- `src/audio.js` / `src/haptics.js` — synthesized sounds; haptics use the
  Vibration API on Android and the iOS 18+ switch-control tick on iPhone.
- `sw.js` + `manifest.webmanifest` — offline play and home-screen install.

Progress and settings are stored in `localStorage` on the device.

## Develop

```bash
npm test                  # engine + generator checks (levels 1-120 solvable)
python3 -m http.server    # then open http://localhost:8000
```
