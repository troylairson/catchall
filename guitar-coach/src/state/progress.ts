import { createStore } from './store';
import { LessonProgress, emptyProgress } from '../lessons/path';

export interface Progress {
  lessons: Record<number, LessonProgress>;
  setupDone: boolean;
  /** Best changes-per-minute per drill key, e.g. "cEasy-gEasy". */
  bestSwitch: Record<string, number>;
  /** Recent timing scores, newest first. */
  rhythmHistory: { at: number; title: string; score: number }[];
}

export const progress = createStore<Progress>('gc.progress.v1', {
  lessons: {},
  setupDone: false,
  bestSwitch: {},
  rhythmHistory: [],
});

export function lessonProgress(id: number): LessonProgress {
  return progress.get().lessons[id] ?? emptyProgress();
}

export function saveLessonProgress(id: number, p: LessonProgress) {
  progress.set((s) => ({ lessons: { ...s.lessons, [id]: p } }));
}

export function recordRhythm(title: string, score: number) {
  progress.set((s) => ({ rhythmHistory: [{ at: Date.now(), title, score }, ...s.rhythmHistory].slice(0, 50) }));
}

export function recordSwitch(key: string, perMin: number) {
  progress.set((s) => ({ bestSwitch: { ...s.bestSwitch, [key]: Math.max(perMin, s.bestSwitch[key] ?? 0) } }));
}
