import { ChordId } from '../music/chords';
import { RhythmCfg, SONGS } from '../music/songs';

export interface SwitchCfg {
  /** Chords to cycle through, e.g. ['cEasy','gEasy']. */
  chords: ChordId[];
  seconds: number;
  /** Correct changes needed to pass. */
  target: number;
}

interface Base {
  id: string;
  title: string;
}

export type Step =
  | (Base & { kind: 'talk'; body: string[]; chord?: ChordId; hands?: boolean })
  | (Base & { kind: 'setup' })
  | (Base & { kind: 'tuner' })
  | (Base & { kind: 'rhythm'; cfg: RhythmCfg; pass: number; song?: boolean; smaller?: Step[] })
  | (Base & { kind: 'shape'; chord: ChordId; onlyStrings?: number[]; smaller?: Step[] })
  | (Base & { kind: 'switch'; cfg: SwitchCfg; smaller?: Step[] });

export type CheckStep = Extract<Step, { smaller?: Step[] }>;

export interface Lesson {
  id: number;
  title: string;
  skill: string;
  minutes: string;
  steps: Step[];
  /** Shown when the lesson is finished. */
  win: string;
}

const rhythm = (id: string, title: string, cfg: Partial<RhythmCfg>, pass = 0.6, smaller?: Step[]): Step => ({
  id,
  title,
  kind: 'rhythm',
  pass,
  cfg: { title, bpm: 60, bars: 4, pattern: [0, 1, 2, 3], chords: ['emEasy'], ...cfg },
  smaller,
});

const song = (id: string, key: keyof typeof SONGS, pass: number, smaller?: Step[], over: Partial<RhythmCfg> = {}): Step => ({
  id,
  title: `Play “${SONGS[key].title}”`,
  kind: 'rhythm',
  song: true,
  pass,
  cfg: { ...SONGS[key], ...over },
  smaller,
});

export const LESSONS: Lesson[] = [
  {
    id: 1,
    title: 'Can I hear you?',
    skill: 'Get your guitar, amp and laptop talking to each other',
    minutes: '5 min',
    win: 'The app can hear every string. Everything from here on is playing.',
    steps: [
      {
        id: 'l1-talk',
        kind: 'talk',
        title: 'Set up your space',
        body: [
          'Plug your guitar into your amp and turn the amp on. Use a clean sound — turn any "gain", "drive" or "distortion" knob all the way down.',
          'Set the amp volume to "comfortable conversation" loud. Not quiet, not shouting.',
          'Put your laptop about an arm’s length from the amp, with the screen facing you.',
          'Have your pick ready. Hold it between your thumb and the side of your pointer finger, with just the tip poking out.',
        ],
      },
      { id: 'l1-setup', kind: 'setup', title: 'Setup check' },
    ],
  },
  {
    id: 2,
    title: 'Tune up',
    skill: 'Get each string sounding right',
    minutes: '5–10 min',
    win: 'Your guitar is in tune. Do this at the start of every practice — it gets quick.',
    steps: [
      {
        id: 'l2-talk',
        kind: 'talk',
        title: 'How tuning works',
        body: [
          'Each string has a knob (a "tuning peg") at the end of the neck.',
          'Turning a peg one way tightens the string (sounds higher). The other way loosens it (sounds lower).',
          'Play one string, let it ring, and the app will say “Tighten”, “Loosen” or “Good”.',
          'Turn slowly — a small turn makes a big difference. If you’re not sure which way tightens, turn a tiny bit and watch the needle.',
        ],
      },
      { id: 'l2-tuner', kind: 'tuner', title: 'Tune all 6 strings' },
    ],
  },
  {
    id: 3,
    title: 'Strum on the beat — and play a song',
    skill: 'Strum in time with the beat',
    minutes: '10 min',
    win: 'You just played a whole song in time. That’s real guitar playing.',
    steps: [
      {
        id: 'l3-talk',
        kind: 'talk',
        title: 'Your first chord needs no fingers',
        chord: 'emEasy',
        body: [
          'Strum just the 3 thinnest strings (the bottom three in the picture). Don’t press anything with your other hand — just rest it on the neck.',
          'That sound is a real chord, called “Em”. It’s used in thousands of songs.',
          'Strum down, from the 3rd-thinnest string through the thinnest, in one smooth move.',
        ],
      },
      rhythm('l3-r1', 'One strum per bar', { pattern: [0], bpm: 60, bars: 4 }, 0.6, [
        rhythm('l3-r1s', 'One strum per bar, slower', { pattern: [0], bpm: 50, bars: 4 }, 0.5),
      ]),
      rhythm('l3-r2', 'Strum on every beat', { pattern: [0, 1, 2, 3], bpm: 60, bars: 4 }, 0.6, [
        rhythm('l3-r2s', 'Every other beat', { pattern: [0, 2], bpm: 60, bars: 4 }, 0.6),
        rhythm('l3-r2ss', 'Every other beat, slower', { pattern: [0, 2], bpm: 50, bars: 4 }, 0.5),
      ]),
      song('l3-song', 'firstLight', 0.55, [song('l3-song-s', 'firstLight', 0.5, undefined, { pattern: [0, 2], bpm: 60 })]),
    ],
  },
  {
    id: 4,
    title: 'Your first finger: easy C',
    skill: 'Press one string cleanly',
    minutes: '8 min',
    win: 'You can press a string so it rings clearly — the core skill of every chord.',
    steps: [
      {
        id: 'l4-talk',
        kind: 'talk',
        title: 'Pressing a string',
        chord: 'cEasy',
        hands: true,
        body: [
          'Your fingers have colors and numbers. Pointer = 1 (blue).',
          'Put the tip of your pointer finger on the 2nd-thinnest string, in space 1 (the first gap from the end of the neck).',
          'Press right next to the metal bar on the side away from the end of the neck. You don’t need to press hard — close to the bar is the trick.',
          'Keep your finger curved like you’re holding a ball, so it doesn’t touch the thinnest string.',
        ],
      },
      { id: 'l4-shape', kind: 'shape', title: 'Check your C shape', chord: 'cEasy', smaller: [{ id: 'l4-shape-s', kind: 'shape', title: 'Just the pressed string', chord: 'cEasy', onlyStrings: [4] }] },
      rhythm('l4-r', 'Strum C in time', { chords: ['cEasy'], pattern: [0, 2], bpm: 60, bars: 4 }, 0.6, [
        rhythm('l4-r-s', 'Strum C, one per bar', { chords: ['cEasy'], pattern: [0], bpm: 60, bars: 4 }, 0.5),
      ]),
    ],
  },
  {
    id: 5,
    title: 'Easy G',
    skill: 'Make a second chord shape',
    minutes: '8 min',
    win: 'Two chords in your hands. Next: moving between them.',
    steps: [
      {
        id: 'l5-talk',
        kind: 'talk',
        title: 'The ring finger chord',
        chord: 'gEasy',
        hands: true,
        body: [
          'Ring finger = 3 (orange).',
          'Put its tip on the thinnest string, in space 3.',
          'Again: right next to the metal bar, finger curved, tip only.',
          'Strum the 3 thinnest strings.',
        ],
      },
      { id: 'l5-shape', kind: 'shape', title: 'Check your G shape', chord: 'gEasy', smaller: [{ id: 'l5-shape-s', kind: 'shape', title: 'Just the pressed string', chord: 'gEasy', onlyStrings: [5] }] },
      rhythm('l5-r', 'Strum G in time', { chords: ['gEasy'], pattern: [0, 1, 2, 3], bpm: 60, bars: 4 }, 0.6, [
        rhythm('l5-r-s', 'Strum G, every other beat', { chords: ['gEasy'], pattern: [0, 2], bpm: 60, bars: 4 }, 0.55),
      ]),
    ],
  },
  {
    id: 6,
    title: 'Switch between C and G',
    skill: 'Change chords quickly',
    minutes: '10 min',
    win: 'Switching chords is the skill most beginners get stuck on — and you’re doing it.',
    steps: [
      {
        id: 'l6-talk',
        kind: 'talk',
        title: 'Lift, glide, land',
        hands: true,
        body: [
          'To go from C to G: lift your pointer off, and put your ring finger down on the thinnest string, space 3.',
          'Don’t lift your hand far away — hover your fingers just above the strings.',
          'Look at where your finger is going before it gets there.',
          'You’ll strum once on each chord. As soon as I hear the right chord, I’ll show the next one. Go as fast as you can while staying clean.',
        ],
      },
      { id: 'l6-sw', kind: 'switch', title: 'C ↔ G speed drill', cfg: { chords: ['cEasy', 'gEasy'], seconds: 30, target: 8 }, smaller: [
        { id: 'l6-sw-s', kind: 'switch', title: 'C ↔ G, more time', cfg: { chords: ['cEasy', 'gEasy'], seconds: 45, target: 6 } },
        { id: 'l6-sw-ss', kind: 'switch', title: 'C ↔ G, slow and steady', cfg: { chords: ['cEasy', 'gEasy'], seconds: 60, target: 4 } },
      ] },
    ],
  },
  {
    id: 7,
    title: 'Your two-chord song',
    skill: 'Change chords while keeping the beat',
    minutes: '8 min',
    win: 'A song with chord changes, in time. That’s how most songs work.',
    steps: [
      {
        id: 'l7-talk',
        kind: 'talk',
        title: 'Change early',
        body: [
          'In a song the beat doesn’t wait for you. The trick: start moving to the next chord a little early.',
          'Watch for the chord name coming up in the lane. When you see it getting close, start your switch.',
          'If your fingers aren’t ready, strum anyway. Keeping the beat matters more than a perfect chord.',
        ],
      },
      song('l7-song', 'backPorch', 0.55, [
        song('l7-song-s', 'backPorch', 0.5, undefined, { bpm: 56 }),
        song('l7-song-ss', 'backPorch', 0.5, undefined, { bpm: 50, pattern: [0] }),
      ]),
    ],
  },
  {
    id: 8,
    title: 'Three chords: add Em',
    skill: 'Move between three chords',
    minutes: '8 min',
    win: 'G, C and Em — enough chords to play hundreds of songs.',
    steps: [
      {
        id: 'l8-talk',
        kind: 'talk',
        title: 'Em is the “lift off” chord',
        chord: 'emEasy',
        body: [
          'You already know Em from lesson 3: no fingers on the strings at all.',
          'So getting to Em is easy — just lift your finger off. Getting away from Em means landing a finger.',
          'The drill cycles G → Em → C → Em → G…',
        ],
      },
      { id: 'l8-sw', kind: 'switch', title: 'G → Em → C speed drill', cfg: { chords: ['gEasy', 'emEasy', 'cEasy', 'emEasy'], seconds: 30, target: 8 }, smaller: [
        { id: 'l8-sw-s', kind: 'switch', title: 'G ↔ Em only', cfg: { chords: ['gEasy', 'emEasy'], seconds: 30, target: 6 } },
        { id: 'l8-sw-ss', kind: 'switch', title: 'C ↔ Em only', cfg: { chords: ['cEasy', 'emEasy'], seconds: 45, target: 6 } },
      ] },
    ],
  },
  {
    id: 9,
    title: 'Change on time',
    skill: 'Land each new chord right on beat 1',
    minutes: '8 min',
    win: 'Your chord changes land on the beat. That’s the hardest part of playing songs.',
    steps: [
      {
        id: 'l9-talk',
        kind: 'talk',
        title: 'Use the last beat to move',
        body: [
          'Here, the chord changes every 4 beats.',
          'Professional trick: on the 4th beat, your fretting hand is already moving to the next chord. The strum on beat 4 can sound a bit messy — that’s normal and nobody notices.',
          'Count along out loud: “1, 2, 3, change”.',
        ],
      },
      rhythm('l9-r', 'G → C → Em → C, every beat', { chords: ['gEasy', 'cEasy', 'emEasy', 'cEasy'], pattern: [0, 1, 2, 3], bpm: 60, bars: 8 }, 0.6, [
        rhythm('l9-r-s', 'Skip beat 4 to change', { chords: ['gEasy', 'cEasy', 'emEasy', 'cEasy'], pattern: [0, 1, 2], bpm: 60, bars: 8 }, 0.6),
        rhythm('l9-r-ss', 'Two strums, then change', { chords: ['gEasy', 'cEasy', 'emEasy', 'cEasy'], pattern: [0, 2], bpm: 54, bars: 8 }, 0.55),
      ]),
    ],
  },
  {
    id: 10,
    title: 'Your three-chord song',
    skill: 'Play a full song with three chords',
    minutes: '10 min',
    win: 'You finished the starter path! You can tune, strum in time, and play songs with three chords.',
    steps: [
      {
        id: 'l10-talk',
        kind: 'talk',
        title: '“Open Road”',
        body: [
          'This uses the same chord loop — Em, C, G — that powers loads of pop songs.',
          'Play it a few times. Each time, try to look at the screen a bit more and your hands a bit less.',
        ],
      },
      song('l10-song', 'openRoad', 0.6, [
        song('l10-song-s', 'openRoad', 0.55, undefined, { pattern: [0, 2] }),
        song('l10-song-ss', 'openRoad', 0.5, undefined, { pattern: [0, 2], bpm: 58 }),
      ]),
    ],
  },
];

export function findStep(lesson: Lesson, id: string): Step | undefined {
  for (const s of lesson.steps) {
    if (s.id === id) return s;
    if ('smaller' in s && s.smaller) for (const sm of s.smaller) if (sm.id === id) return sm;
  }
  return undefined;
}
