# First Chords — electric guitar coach for total beginners

A browser app (Chrome on a laptop) that listens to your guitar and teaches you to play
simple songs, without music notation or jargon.

**Live:** https://troylairson.github.io/catchall/guitar/ (deployed by `.github/workflows/pages.yml` on every push)

```bash
cd guitar-coach
npm install
npm run dev        # open http://localhost:5173/catchall/guitar/ in Chrome
npm test           # unit tests (timing feedback, lesson path, chord matching)
npm run build      # type-check + production build
```

## What's in it

| Order | Feature | Where |
|---|---|---|
| 1 | **Tuner**: says *Tighten* / *Loosen* / *Good!*, guesses the string, or tap a string to lock onto it | `src/features/Tuner.tsx` |
| 2 | **Setup check**: pick laptop mic or USB interface, quiet-room check (sets the strum gate), delay measurement, then pluck each string once | `src/features/SetupCheck.tsx` |
| 3 | **Strum-on-the-beat game**: *Watch* → *Tap* (spacebar) → *Play*, with plain-word feedback and a fix | `src/features/RhythmGame.tsx`, `rhythmRun.ts`, `components/BeatLane.tsx` |
| 4 | **Chord-switch speed drill**: easy G, C, Em (1 finger, 1 finger, no fingers) | `src/features/SwitchDrill.tsx` |
| 5 | **10-lesson starter path** that adds smaller steps when you get stuck | `src/lessons/lessons.ts`, `src/lessons/path.ts` |
| — | **Chord shape check**: pluck string-by-string; says which finger isn't pressing / is one space off / is muffling a string | `src/features/ChordShapeCheck.tsx` |
| — | **Debug panel** (🛠 button or <kbd>`</kbd>): live pitch, volume, strum timing offset, chord guess, every threshold as a slider | `src/components/DebugPanel.tsx` |

### How the design rules are met

- **No notation or jargon.** Strings are "thickest" … "thinnest"; frets are "space 1, 2, 3"; tuning is "tighten / loosen".
- **Fretboard drawn as seen from above:** end of the neck on the left, thickest string on top, as you see it looking down at your guitar. There's a *Left-handed* toggle.
- **Finger colors 1–4:** pointer = blue, middle = green, ring = orange, pinky = purple. The same colors appear on the neck and on a hand picture.
- **One skill per 5–10 minute lesson.** Each lesson names its one skill.
- **Plain-English feedback with a fix.** Every problem comes with a "Try this:" fix (rushing, dragging, speeding up, uneven, missed beats, extra strums, unpressed string, muffled string, wrong string, hitting thick strings).
- **Visual rhythm before playing.** Each rhythm step shows the pattern first, then *Watch* (dots slide in with strum sounds), *Tap*, then *Play*.
- **Easy chord versions first.** Em takes no fingers (just the 3 thinnest strings), C and G take one finger each. Fuller versions are in `chords.ts` for later.
- **A win by lesson 3.** Lesson 3 ends with playing a whole (original) song, "First Light", over a drum beat.

### The lesson path

1. Can I hear you? (setup) · 2. Tune up · 3. Strum on the beat, then play a song · 4. Easy C (shape check) ·
5. Easy G · 6. C ↔ G switching · 7. Two-chord song · 8. Add Em, three-chord switching · 9. Change on time · 10. Three-chord song

**Smaller steps.** If you fail a check twice, the app adds the next easier version of it in front (slower, fewer
strums, one string at a time, or "skip beat 4 to change"). If you're still stuck on that, it adds an even
smaller one. Added steps show in the lesson's step list and on the home page. Every check also has an
escape hatch ("It sounded right to me", or <kbd>Enter</kbd> in the switch drill), so a detection problem
never blocks you.

## Testing with your guitar: suggested order

The detection was tested against synthesized guitar recordings fed into headless Chrome as a fake mic, not
against a real guitar and amp. Expect to adjust a few sliders. Open the debug panel (<kbd>`</kbd>) for all of this.

1. **Tuner.** Pluck the 2nd-thickest string. *Pitch* should read about 110 Hz. If it's blank, lower *Pitch confidence*
   or *Pitch min volume*. If the thickest string reads ~165 Hz, the detector is jumping an octave. The tuner still works,
   because it ignores octave jumps.
2. **Setup check.** Run all four parts. The quiet-room part sets *Strum gate* automatically, and the beep part sets *Latency*.
3. **Strums.** Strum steadily and watch *Last strum* and *Strum gaps*:
   - **Strums missed** → lower *Strum jump* (default 5 dB) or *Strum gate*, or raise *Input boost*.
   - **One strum counted twice** (gaps under ~150 ms) → raise *Strum cooldown*.
   - **Clicks or drums counted as strums** (strums appear while your hand is still) → raise *Strum gate*, lower *Click volume*, or use headphones for the laptop sound.
4. **Timing.** In the strum game, *Timing offset* shows each strum's offset in ms. If you're always marked late or
   early by the same amount when you know you're on the beat, redo the delay measurement (or nudge *Latency*).
5. **Chords.** Strum an easy C and check *Last chord guess* and the note bars. If correct chords get rejected, lower
   *Chord match*.

*Copy debug info* puts the settings, recent strums and the log on your clipboard, for reporting problems.

### Audio notes

- **Laptop mic:** browser echo cancellation, noise suppression and auto-gain are turned off. Use a clean amp sound with no distortion.
- **USB interface:** choose it in Setup. If the guitar is only on input 1, pick "Input 1 only". The beep delay
  test can't hear the laptop speakers through an interface, so use "Strum along" for the delay.
- Strum detection listens to the 400 Hz–3 kHz band. That catches the pick attack and skips the backing kick and bass,
  and the metronome tick (6–7 kHz). Detection runs in an AudioWorklet with ~1.5 ms resolution, on the same clock
  that schedules the beats.
- Chord checks compare the strum's note-energy profile ("chroma") against each easy chord, overtones included.
  This works for telling G, C and Em apart. It's a heuristic, so the string-by-string shape check gives the most
  precise feedback.

## Code map

```
src/audio/engine.ts        mic/interface input, filters, pitch (pitchy), chroma, clock helpers
src/audio/onsetWorklet.ts  strum detector (AudioWorklet)
src/audio/chroma.ts        chord templates, matching, plain-English chord diagnosis
src/audio/synth.ts         click, beep, drums, bass, plucked-string strums (for "hear it")
src/feedback/timing.ts     beat matching + feedback text (pure, unit-tested)
src/lessons/               lesson content + stall/smaller-step logic (pure, unit-tested)
src/state/                 localStorage stores: settings (thresholds) and progress
```

The songs ("First Light", "Back Porch", "Open Road") are originals written for this app.
