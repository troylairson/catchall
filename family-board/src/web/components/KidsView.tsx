import type { ActivityAnswer, Board } from '../../shared/types';
import { describeActivity } from '../../shared/recurrence';
import { formatTime, shortDate } from '../../shared/dates';
import { colorVar } from '../lib';
import { Avatar } from './Avatar';

function todayLine(a: ActivityAnswer): string {
  const t = a.today;
  if (a.happening && t) {
    return [`Today ${formatTime(t.startTime)}–${formatTime(t.endTime)}`, t.location, t.note].filter(Boolean).join(' · ');
  }
  if (t && t.status !== 'on') return `Not today: ${t.reason}`;
  return '';
}

function nextLine(a: ActivityAnswer): string {
  if (!a.next) return 'No more dates scheduled';
  const n = a.next;
  const moved = n.movedFrom ? ` (${n.note})` : '';
  return `Next: ${shortDate(n.date)}, ${formatTime(n.startTime)}${moved}`;
}

export function KidsView({ board }: { board: Board }) {
  const kids = board.people.filter(p => p.role === 'kid');
  return (
    <div className="kids-page">
    <a className="link-btn kids-edit" href="#/activities">Add or edit activities</a>
    <div className="kids" style={{ '--n': kids.length } as React.CSSProperties}>
      {kids.map(kid => {
        const acts = board.activities.filter(a => a.personId === kid.id);
        return (
          <section key={kid.id} className="kid" style={colorVar(kid)} aria-label={kid.name}>
            <header className="kid-head">
              <Avatar person={kid} size="lg" />
              <h2>{kid.name}</h2>
              <span className="kid-q">Is today a … day?</span>
            </header>
            {acts.length === 0 && (
              <p className="empty">No activities yet. Add them on your phone under Activities.</p>
            )}
            {acts.map(act => {
              const ans = board.answers.find(a => a.activityId === act.id)!;
              const line = todayLine(ans);
              return (
                <div key={act.id} className="act">
                  <div className={`ans ${ans.happening ? 'yes' : 'no'}`}>{ans.happening ? 'Yes' : 'No'}</div>
                  <div className="act-body">
                    <div className="act-name">{act.icon} {act.name}</div>
                    {line && <div className={`act-today${ans.happening ? '' : ' off'}`}>{line}</div>}
                    {!ans.happening && <div className="act-next">{nextLine(ans)}</div>}
                    <div className="act-rule">{describeActivity(act)}</div>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
    </div>
  );
}
