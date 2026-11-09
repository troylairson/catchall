import { FINGER_COLORS, FINGER_NAMES, Finger } from '../music/chords';

/** Your fretting hand with each finger's color and number. */
export function Hand({ highlight }: { highlight?: Finger[] }) {
  const fingers: { f: Finger; x: number; h: number }[] = [
    { f: 1, x: 62, h: 92 },
    { f: 2, x: 92, h: 104 },
    { f: 3, x: 122, h: 96 },
    { f: 4, x: 150, h: 76 },
  ];
  return (
    <figure className="hand">
      <svg viewBox="0 0 200 210" role="img" aria-label="Finger colors">
        {/* thumb */}
        <rect x={10} y={120} width={30} height={70} rx={15} transform="rotate(-35 25 155)" fill="var(--skin)" />
        <rect x={45} y={110} width={122} height={92} rx={28} fill="var(--skin)" />
        {fingers.map(({ f, x, h }) => {
          const dim = highlight && !highlight.includes(f);
          return (
            <g key={f} opacity={dim ? 0.35 : 1}>
              <rect x={x - 13} y={125 - h} width={26} height={h + 10} rx={13} fill="var(--skin)" />
              <circle cx={x} cy={125 - h + 14} r={13} fill={FINGER_COLORS[f]} />
              <text x={x} y={125 - h + 19} textAnchor="middle" className="fb-finger small">
                {f}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        {fingers.map(({ f }) => (
          <span key={f} className="finger-chip" style={{ background: FINGER_COLORS[f] }}>
            {f} {FINGER_NAMES[f]}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
