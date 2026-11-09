import { Chord, FINGER_COLORS, Finger } from '../music/chords';
import { settings } from '../state/settings';

export type StringMark = 'ok' | 'bad' | 'active';

interface Props {
  chord?: Chord;
  /** Strings to light up (e.g. the one to pluck next, or the one being tuned). */
  marks?: Partial<Record<number, StringMark>>;
  onStringClick?: (i: number) => void;
  spaces?: number;
  small?: boolean;
  caption?: boolean;
}

/**
 * The neck drawn the way you see it when you look down at your guitar:
 * end of the neck on the left (right for left-handers), thickest string on top.
 */
export function Fretboard({ chord, marks = {}, onStringClick, spaces = 4, small, caption = true }: Props) {
  const { leftHanded } = settings.use();
  const W = 560;
  const top = 34;
  const gap = 30;
  const nut = 92;
  const spaceW = 100;
  const H = top + gap * 5 + 52;
  const mx = (x: number) => (leftHanded ? W - x : x);
  const yOf = (i: number) => top + i * gap;
  const end = nut + spaces * spaceW;

  const played = chord ? chord.strings.map((s) => s.fret !== 'x') : [true, true, true, true, true, true];
  const firstPlayed = played.indexOf(true);
  const lastPlayed = played.lastIndexOf(true);

  return (
    <figure className={`fretboard ${small ? 'small' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chord ? `${chord.name} chord shape` : 'Guitar neck'}>
        {/* neck wood */}
        <rect x={Math.min(mx(nut), mx(end))} y={top - 16} width={end - nut} height={gap * 5 + 32} rx={4} fill="var(--wood)" />
        {/* headstock end hint */}
        <text x={mx(nut - 50)} y={top - 20} className="fb-hint" textAnchor="middle">
          end of neck
        </text>
        {/* nut */}
        <rect x={mx(nut) - (leftHanded ? 8 : 0)} y={top - 16} width={8} height={gap * 5 + 32} fill="var(--nut)" rx={2} />
        {/* metal bars */}
        {Array.from({ length: spaces }, (_, k) => {
          const x = mx(nut + (k + 1) * spaceW);
          return <line key={k} x1={x} x2={x} y1={top - 16} y2={top + gap * 5 + 16} stroke="var(--fret)" strokeWidth={4} />;
        })}
        {/* space numbers */}
        {Array.from({ length: spaces }, (_, k) => (
          <text key={k} x={mx(nut + k * spaceW + spaceW / 2)} y={top + gap * 5 + 40} className="fb-space" textAnchor="middle">
            space {k + 1}
          </text>
        ))}
        {/* strings */}
        {Array.from({ length: 6 }, (_, i) => {
          const y = yOf(i);
          const m = marks[i];
          const color = m === 'ok' ? 'var(--good)' : m === 'bad' ? 'var(--bad)' : m === 'active' ? 'var(--accent)' : 'var(--string)';
          const dim = !played[i] && !m;
          return (
            <g key={i} onClick={onStringClick ? () => onStringClick(i) : undefined} style={{ cursor: onStringClick ? 'pointer' : undefined }}>
              <rect x={0} y={y - gap / 2} width={W} height={gap} fill="transparent" />
              <line
                x1={mx(nut - 4)}
                x2={mx(W - 8)}
                y1={y}
                y2={y}
                stroke={color}
                strokeWidth={(m ? 2 : 0) + 4.6 - i * 0.65}
                opacity={dim ? 0.3 : 1}
                className={m === 'active' ? 'pulse' : undefined}
              />
            </g>
          );
        })}
        {/* open / skip markers */}
        {chord &&
          chord.strings.map((s, i) => {
            const x = mx(nut - 22);
            const y = yOf(i);
            if (s.fret === 'x')
              return (
                <text key={i} x={x} y={y + 6} textAnchor="middle" className="fb-skip">
                  ✕
                </text>
              );
            if (s.fret === 0) return <circle key={i} cx={x} cy={y} r={9} fill="none" stroke="var(--ink)" strokeWidth={2.5} />;
            return null;
          })}
        {/* finger dots: placed close to the metal bar, where you should press */}
        {chord &&
          chord.strings.map((s, i) => {
            if (s.fret === 'x' || s.fret === 0 || !('finger' in s)) return null;
            const f = s.finger as Finger;
            const x = mx(nut + s.fret * spaceW - 30);
            const y = yOf(i);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={15} fill={FINGER_COLORS[f]} stroke="#fff" strokeWidth={2.5} />
                <text x={x} y={y + 6} textAnchor="middle" className="fb-finger">
                  {f}
                </text>
              </g>
            );
          })}
        {/* strum bracket */}
        {chord && firstPlayed >= 0 && (
          <g>
            <line x1={mx(W - 20)} x2={mx(W - 20)} y1={yOf(firstPlayed) - 6} y2={yOf(lastPlayed) + 4} stroke="var(--accent)" strokeWidth={4} markerEnd="url(#arrow)" />
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" />
              </marker>
            </defs>
            <text x={mx(W - 20)} y={yOf(firstPlayed) - 14} textAnchor="middle" className="fb-hint strong">
              strum
            </text>
          </g>
        )}
        {/* thick / thin labels */}
        <text x={mx(8)} y={yOf(0) + 5} className="fb-hint" textAnchor={leftHanded ? 'end' : 'start'}>
          thick
        </text>
        <text x={mx(8)} y={yOf(5) + 5} className="fb-hint" textAnchor={leftHanded ? 'end' : 'start'}>
          thin
        </text>
      </svg>
      {caption && <figcaption>As you see it when you look down at your guitar.</figcaption>}
    </figure>
  );
}
