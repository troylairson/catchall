import { useState } from 'react';
import { api } from '../api';

/** A to-do that can be checked off with one tap. Shows the new state right away. */
export function TodoCheck({ itemId, done, title, detail, className = '', style }: {
  itemId: string; done: boolean; title: string; detail?: string; className?: string; style?: React.CSSProperties;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? done;
  return (
    <button
      className={`todo ${checked ? 'checked' : ''} ${className}`}
      style={style}
      role="checkbox"
      aria-checked={checked}
      onClick={() => {
        setOptimistic(!checked);
        api('PUT', `/api/items/${itemId}`, { done: !checked }).catch(() => setOptimistic(null)).finally(() => {
          // The board refreshes from the server; drop the local copy shortly after.
          window.setTimeout(() => setOptimistic(null), 1500);
        });
      }}
    >
      <span className="todo-box" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span className="todo-text">
        <span className="todo-title">{title}</span>
        {detail && <span className="todo-detail">{detail}</span>}
      </span>
    </button>
  );
}
