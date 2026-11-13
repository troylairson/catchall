/** Light or dark appearance, chosen per device (the wall and each phone can differ).
 *  Saved in this browser only. */

import { useEffect, useState } from 'react';
import type { Board } from '../shared/types';
import { isDimTime } from './lib';

export type ThemeChoice = 'auto' | 'light' | 'dark' | 'night';

const KEY = 'family-board-theme';
const listeners = new Set<(c: ThemeChoice) => void>();

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'night') return v;
  } catch { /* storage unavailable: fall back to the device setting */ }
  return 'auto';
}

export function setThemeChoice(choice: ThemeChoice): void {
  try { localStorage.setItem(KEY, choice); } catch { /* not saved, still applied below */ }
  for (const fn of listeners) fn(choice);
}

export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState(getThemeChoice);
  useEffect(() => {
    listeners.add(setChoice);
    return () => { listeners.delete(setChoice); };
  }, []);
  return choice;
}

/** Applies the choice to the page. "Dark at night" follows the wall's dim hours. */
export function useApplyTheme(board: Board | null): void {
  const choice = useThemeChoice();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (choice !== 'night') return;
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [choice]);

  useEffect(() => {
    const root = document.documentElement;
    let mode: 'light' | 'dark' | null = null;
    if (choice === 'light' || choice === 'dark') mode = choice;
    else if (choice === 'night') mode = board && isDimTime(board, new Date()) ? 'dark' : 'light';
    if (mode) root.dataset.theme = mode;
    else delete root.dataset.theme;
    // Match the browser's own toolbar color on phones.
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(m => {
      // Remember the original values so "Match this device" can put them back.
      m.dataset.content ??= m.getAttribute('content') ?? '';
      m.dataset.media ??= m.getAttribute('media') ?? '';
      if (mode) {
        m.setAttribute('content', bg);
        m.removeAttribute('media');
      } else {
        m.setAttribute('content', m.dataset.content);
        if (m.dataset.media) m.setAttribute('media', m.dataset.media);
      }
    });
  }, [choice, board, tick]);
}
