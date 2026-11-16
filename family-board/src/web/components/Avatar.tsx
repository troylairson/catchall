import type { Person } from '../../shared/types';
import type { AwayEntry } from '../lib';
import { textOn } from '../../shared/colors';

export function Avatar({ person, away, size = 'md' }: { person: Person; away?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: person.color, color: textOn(person.color), '--c': person.color } as React.CSSProperties}
      aria-hidden="true"
    >
      {person.emoji || person.name.charAt(0)}
      {away && <span className="avatar-badge" title="Traveling">✈</span>}
    </span>
  );
}

/** A row of dots counting down the nights until someone is home. */
export function Sleeps({ total, done }: { total: number; done: number }) {
  const left = total - done;
  return (
    <span className="sleeps" role="img" aria-label={`${left} ${left === 1 ? 'sleep' : 'sleeps'} until home`}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < done ? 'done' : ''} />)}
    </span>
  );
}

/** Stands in for an avatar when the whole family is meant. */
export function FamilyMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar avatar-${size} family-mark`} aria-hidden="true">
      ✈
    </span>
  );
}

/** The traveler's avatar, the kids' avatars side by side, or a plane for the whole family. */
export function AwayMark({ entry }: { entry: AwayEntry }) {
  if (entry.person) return <Avatar person={entry.person} size="sm" away />;
  if (entry.people.length && entry.people.length < 4 && entry.trip.personId !== 'everyone') {
    return <span className="avatar-group">{entry.people.map(p => <Avatar key={p.id} person={p} size="sm" />)}</span>;
  }
  return <FamilyMark size="sm" />;
}
