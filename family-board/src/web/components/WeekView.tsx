import type { Board, Person } from '../../shared/types';
import { dateRange, dayOfMonth, shortDate, weekdayName } from '../../shared/dates';
import { activeTrip, colorVar, itemsFor, type DayItem } from '../lib';
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

export function WeekView({ board }: { board: Board }) {
  const days = dateRange(board.from, board.to);
  const hasFamily = days.some(d => itemsFor(board, d, null).length > 0);
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
          const trip = person ? activeTrip(board, person.id, d) : null;
          if (trip) {
            // One block across the consecutive days of the trip.
            let span = 1;
            while (i + span < days.length && days[i + span] <= trip.endsOn) span++;
            cells.push(
              <div key={d} className="wk-trip" style={{ gridColumn: `span ${span}`, ...colorVar(person!) }}>
                <div className="wk-trip-city">✈ {trip.city}</div>
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
