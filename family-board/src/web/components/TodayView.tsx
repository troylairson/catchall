import type { Board, Person } from '../../shared/types';
import { formatTime, shortDate } from '../../shared/dates';
import { colorVar, dinnerOn, familyTrip, itemsFor, nowMinutes, personalTrip, personById, tripProgress, type DayItem } from '../lib';
import { Avatar } from './Avatar';
import { TodoCheck } from './TodoCheck';

function ItemCard({ item, past, next, color }: { item: DayItem; past: boolean; next: boolean; color: React.CSSProperties }) {
  if (item.kind === 'todo') {
    return <TodoCheck itemId={item.itemId!} done={!!item.done} title={item.title} detail={item.timeLabel} className="ev-todo" style={color} />;
  }
  const off = item.status !== 'on';
  return (
    <div className={`ev${past ? ' past' : ''}${next ? ' next' : ''}${off ? ' off' : ''}`} style={color}>
      <div className="ev-time">
        <span>{item.timeLabel}</span>
        {next && <span className="ev-next">Next</span>}
      </div>
      <div className="ev-title">{item.icon && <span className="ev-icon">{item.icon}</span>}{item.title}</div>
      {off && <div className="ev-reason">Not today · {item.reason}</div>}
      {!off && (item.awayTimeLabel || item.location || item.note) && (
        <div className="ev-detail">
          {[item.awayTimeLabel && `${item.awayTimeLabel} there`, item.location, item.note].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
}

function NowLine({ label }: { label: string }) {
  return <div className="now-line"><span>{label}</span></div>;
}

function Column({ board, person, now }: { board: Board; person: Person; now: Date }) {
  const today = board.today;
  const items = itemsFor(board, today, person.id);
  // The whole family's trip shows once above the columns, not in each one.
  const trip = personalTrip(board, person.id, today);
  const { minutes, date } = nowMinutes(board, now);
  const isToday = date === today;
  const timed = items.filter(i => !i.allDay);
  const nextIdx = isToday ? timed.findIndex(i => i.status === 'on' && i.minutes >= minutes) : -1;
  const nowLabel = formatTime(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);

  let lineShown = !isToday;
  const body: React.ReactNode[] = [];
  items.filter(i => i.allDay).forEach(i => body.push(<ItemCard key={i.key} item={i} past={false} next={false} color={colorVar(person)} />));
  timed.forEach((i, idx) => {
    if (!lineShown && i.minutes >= minutes) { body.push(<NowLine key="now" label={nowLabel} />); lineShown = true; }
    body.push(<ItemCard key={i.key} item={i} past={isToday && i.endMinutes < minutes} next={idx === nextIdx} color={colorVar(person)} />);
  });
  if (!lineShown) body.push(<NowLine key="now" label={nowLabel} />);

  const count = items.filter(i => i.status === 'on').length;
  return (
    <section className={`col${trip ? ' away' : ''}`} style={colorVar(person)} aria-label={person.name}>
      <header className="col-head">
        <Avatar person={person} away={!!trip} />
        <div>
          <div className="col-name">{person.name}</div>
          <div className="col-sub">
            {trip ? `Away in ${trip.city}` : count === 0 ? 'Nothing planned' : `${count} ${count === 1 ? 'thing' : 'things'} today`}
          </div>
        </div>
      </header>
      {trip && <TripCard board={board} tripId={trip.id} />}
      <div className="col-body">{body}</div>
    </section>
  );
}

function TripCard({ board, tripId, wide }: { board: Board; tripId: string; wide?: boolean }) {
  const trip = board.trips.find(t => t.id === tripId)!;
  const p = tripProgress(trip, board.today);
  return (
    <div className={`trip${wide ? ' trip-wide' : ''}`}>
      <div className="trip-kicker">✈ {wide ? 'Family trip · ' : ''}Day {p.day} of {p.days}</div>
      <div className="trip-city">{trip.city}</div>
      <div className="trip-bar"><span style={{ width: `${Math.min(100, (p.day / p.days) * 100)}%` }} /></div>
      <div className="trip-row">
        <span>Left {shortDate(trip.startsOn)}</span>
        <span>{trip.returnNote || `Home ${shortDate(trip.endsOn)}`}</span>
      </div>
    </div>
  );
}

export function TodayView({ board, now }: { board: Board; now: Date }) {
  const family = itemsFor(board, board.today, null);
  const noSchool = board.schoolDays.find(d => d.date === board.today && d.kind !== 'info');
  const vacation = familyTrip(board, board.today);
  const dinner = dinnerOn(board, board.today);
  const cook = dinner?.cookId ? personById(board, dinner.cookId) : undefined;
  return (
    <div className="today">
      {vacation && <TripCard board={board} tripId={vacation.id} wide />}
      {(family.length > 0 || noSchool || dinner) && (
        <div className="family-strip">
          <span className="eyebrow">Everyone</span>
          {dinner && <span className="fchip dinner">🍽 Dinner: {dinner.title}{cook && <small>{cook.name} cooking</small>}</span>}
          {noSchool && <span className="fchip school">🏫 {noSchool.kind === 'no_school' ? 'No school' : 'Early release'} <small>{noSchool.label}</small></span>}
          {family.map(i => i.kind === 'todo'
            ? <TodoCheck key={i.key} itemId={i.itemId!} done={!!i.done} title={i.title} className="fchip-todo" />
            : (
              <span key={i.key} className="fchip">
                {i.title}{!i.allDay && <small>{i.timeLabel}</small>}
              </span>
            ))}
        </div>
      )}
      <div className="cols" style={{ '--n': board.people.length } as React.CSSProperties}>
        {board.people.map(p => <Column key={p.id} board={board} person={p} now={now} />)}
      </div>
    </div>
  );
}
