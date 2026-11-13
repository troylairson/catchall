import { useState } from 'react';
import type { Board } from '../../shared/types';
import { addDays, dayOfMonth, monthName, startOfWeek, weekdayName } from '../../shared/dates';
import { useBoard, useNow } from '../api';
import { activeTrip, colorVar, itemsOn, nowMinutes, personById } from '../lib';
import { Avatar } from './Avatar';

export function PhoneAgenda({ today }: { today: string }) {
  const [day, setDay] = useState(today);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const week = startOfWeek(day);
  const { board, error } = useBoard({ from: week, to: addDays(week, 6) });
  const now = useNow();

  if (!board) return <div className="phone-page"><p className="empty">{error ?? 'Loading…'}</p></div>;

  const { minutes, date: nowDate } = nowMinutes(board, now);
  const items = itemsOn(board, day).filter(i =>
    i.personIds.length === 0 ? !hidden.has('family') : i.personIds.some(id => !hidden.has(id)));
  const away = board.people.filter(p => activeTrip(board, p.id, day));
  const noSchool = board.schoolDays.find(d => d.date === day && d.kind === 'no_school');
  const toggle = (id: string) => setHidden(h => {
    const n = new Set(h);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="phone-page">
      <header className="phone-head">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</button>
        <div className="phone-title">
          <h1>{day === today ? 'Today' : weekdayName(day)}</h1>
          <div className="muted">{weekdayName(day)}, {monthName(day)} {dayOfMonth(day)}</div>
        </div>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</button>
      </header>
      {day !== today && <button className="link-btn" onClick={() => setDay(today)}>Back to today</button>}

      {away.map(p => {
        const trip = activeTrip(board, p.id, day)!;
        return (
          <div key={p.id} className="phone-away" style={colorVar(p)}>
            <Avatar person={p} size="sm" away />
            <span><b>{p.name} is in {trip.city}</b>{trip.returnNote && ` · ${trip.returnNote}`}</span>
          </div>
        );
      })}
      {noSchool && <div className="phone-school">🏫 No school · {noSchool.label}</div>}

      <div className="filters" role="group" aria-label="Show people">
        {board.people.map(p => (
          <button key={p.id} aria-pressed={!hidden.has(p.id)} onClick={() => toggle(p.id)} style={colorVar(p)}>
            <span className="dot" />{p.name}
          </button>
        ))}
        <button aria-pressed={!hidden.has('family')} onClick={() => toggle('family')}>
          <span className="dot family" />Family
        </button>
      </div>

      <div className="agenda">
        {items.length === 0 && <p className="empty">Nothing on the calendar.</p>}
        {items.map(i => {
          const people = i.personIds.map(id => personById(board, id)).filter(Boolean) as Board['people'];
          const past = day < nowDate || (day === nowDate && !i.allDay && i.endMinutes < minutes);
          const off = i.status !== 'on';
          return (
            <div key={i.key} className={`agenda-item${past ? ' past' : ''}${off ? ' off' : ''}`} style={colorVar(people[0])}>
              <span className="agenda-time">{i.allDay ? 'All day' : i.timeLabel.split('–')[0]}</span>
              <div className="agenda-body">
                <div className="agenda-title">{i.icon} {i.title}</div>
                <div className="agenda-detail">
                  {off ? `Not today · ${i.reason}` : [i.awayTimeLabel && `${i.awayTimeLabel} there`, i.location, i.note].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="agenda-people">{people.map(p => <Avatar key={p.id} person={p} size="sm" />)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
