import { useState } from 'react';
import type { Board, Person } from '../../shared/types';
import { addDays, dateRange, dayOfMonth, monthName, shortDate, startOfWeek, weekdayName } from '../../shared/dates';
import { useBoard } from '../api';
import { activeTrip, colorVar, familyTrip, itemsFor, personalTrip, type DayItem } from '../lib';
import { Avatar } from './Avatar';

function Chip({ item, person }: { item: DayItem; person?: Person }) {
  if (item.status !== 'on') {
    return (
      <div className="chip off" style={colorVar(person)} title={item.reason}>
        <b>No {item.title.toLowerCase()}</b>{item.reason}
      </div>
    );
  }
  return (
    <div className={`chip${item.note ? ' changed' : ''}`} style={colorVar(person)}>
      <b>{item.allDay ? 'All day' : item.timeLabel.split('–')[0]}</b>
      {item.icon && `${item.icon} `}{item.title}
    </div>
  );
}

function weekLabel(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`;
}

function rangeLabel(from: string, to: string): string {
  const sameMonth = monthName(from) === monthName(to);
  return `${monthName(from, true)} ${dayOfMonth(from)} – ${sameMonth ? '' : `${monthName(to, true)} `}${dayOfMonth(to)}`;
}

/** The week grid with arrows to page through weeks. Starts on the current week. */
export function WeekView({ board }: { board: Board }) {
  const [offset, setOffset] = useState(0);
  const from = addDays(startOfWeek(board.today), offset * 7);
  const to = addDays(from, 6);
  const other = useBoard({ from, to });
  // The current week is already loaded; other weeks load on demand.
  const shown = offset === 0 ? board : other.board && other.board.from === from ? other.board : null;

  return (
    <div className="week-page">
      <div className="week-nav">
        <button className="icon-btn" onClick={() => setOffset(o => o - 1)} aria-label="Previous week">‹</button>
        <div className="week-nav-label">
          <b>{weekLabel(offset)}</b>
          <span className="muted">{rangeLabel(from, to)}</span>
        </div>
        <button className="icon-btn" onClick={() => setOffset(o => o + 1)} aria-label="Next week">›</button>
        {offset !== 0 && <button className="link-btn" onClick={() => setOffset(0)}>Back to this week</button>}
      </div>
      {shown ? <WeekGrid board={shown} /> : <p className="empty">{other.error ?? 'Loading…'}</p>}
    </div>
  );
}

function WeekGrid({ board }: { board: Board }) {
  const days = dateRange(board.from, board.to);
  const hasFamily = days.some(d => itemsFor(board, d, null).length > 0 || familyTrip(board, d));
  const rows: Array<Person | null> = [...board.people, ...(hasFamily ? [null] : [])];

  return (
    <div className="week" style={{ '--days': days.length } as React.CSSProperties}>
      <div />
      {days.map(d => {
        const off = board.schoolDays.find(s => s.date === d && s.kind === 'no_school');
        return (
          <div key={d} className={`wk-head${d === board.today ? ' today' : ''}`}>
            <div className="wk-dow">{weekdayName(d, true)}</div>
            <div className="wk-num">{dayOfMonth(d)}</div>
            {off && <div className="wk-school" title={off.label}>No school</div>}
          </div>
        );
      })}
      {rows.map(person => {
        const cells: React.ReactNode[] = [];
        for (let i = 0; i < days.length; i++) {
          const d = days[i];
          // Individual trips span a person's row; the family's trip spans the Family row.
          const trip = person ? personalTrip(board, person.id, d) : familyTrip(board, d);
          if (trip) {
            // One block across the consecutive days of the trip.
            let span = 1;
            while (i + span < days.length && days[i + span] <= trip.endsOn) span++;
            cells.push(
              <div key={d} className="wk-trip" style={{ gridColumn: `span ${span}`, ...colorVar(person ?? undefined) }}>
                <div className="wk-trip-city">✈ {person ? trip.city : `Family trip to ${trip.city}`}</div>
                <div className="wk-trip-row">{shortDate(trip.startsOn)} – {shortDate(trip.endsOn)}{trip.returnNote && ` · ${trip.returnNote}`}</div>
              </div>,
            );
            i += span - 1;
            continue;
          }
          const items = itemsFor(board, d, person?.id ?? null);
          cells.push(
            <div key={d} className={`wk-cell${d === board.today ? ' today' : ''}`}>
              {items.map(it => <Chip key={it.key} item={it} person={person ?? undefined} />)}
            </div>,
          );
        }
        return (
          <div key={person?.id ?? 'family'} className="wk-row">
            <div className="wk-person">
              {person ? <><Avatar person={person} size="sm" away={!!activeTrip(board, person.id, board.today)} />{person.name}</> : <span className="family-label">Family</span>}
            </div>
            {cells}
          </div>
        );
      })}
    </div>
  );
}
