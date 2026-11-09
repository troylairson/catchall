import { Lesson, LESSONS, Step } from './lessons';

/**
 * Lesson progress and the "add a smaller step when stuck" logic.
 * Pure functions — the React layer stores the result in localStorage.
 */

export interface LessonProgress {
  passed: string[];
  /** Fail count per step since it was last made smaller. */
  fails: Record<string, number>;
  /** How many smaller steps have been added in front of each main step. */
  inserted: Record<string, number>;
  done: boolean;
}

export const STALL_AFTER = 2;

export function emptyProgress(): LessonProgress {
  return { passed: [], fails: {}, inserted: {}, done: false };
}

export interface VisibleStep {
  step: Step;
  /** True for a smaller step added because of a stall. */
  added: boolean;
  /** The main step it belongs to. */
  parentId: string;
}

/** The steps the learner currently sees, with any added smaller steps in front of their parent. */
export function visibleSteps(lesson: Lesson, p: LessonProgress): VisibleStep[] {
  const out: VisibleStep[] = [];
  for (const s of lesson.steps) {
    const k = p.inserted[s.id] ?? 0;
    const smaller = 'smaller' in s && s.smaller ? s.smaller : [];
    // easiest first: smaller[k-1] ... smaller[0], then the main step
    for (let i = Math.min(k, smaller.length) - 1; i >= 0; i--) out.push({ step: smaller[i], added: true, parentId: s.id });
    out.push({ step: s, added: false, parentId: s.id });
  }
  return out;
}

export function currentIndex(lesson: Lesson, p: LessonProgress): number {
  const v = visibleSteps(lesson, p);
  const i = v.findIndex((x) => !p.passed.includes(x.step.id));
  return i < 0 ? v.length : i;
}

export interface Outcome {
  progress: LessonProgress;
  /** Set when a new smaller step was added. */
  added?: Step;
  lessonDone: boolean;
}

export function recordResult(lesson: Lesson, p: LessonProgress, stepId: string, passed: boolean): Outcome {
  const next: LessonProgress = {
    passed: [...p.passed],
    fails: { ...p.fails },
    inserted: { ...p.inserted },
    done: p.done,
  };
  if (passed) {
    if (!next.passed.includes(stepId)) next.passed.push(stepId);
    delete next.fails[stepId];
    const lessonDone = lesson.steps.every((s) => next.passed.includes(s.id));
    if (lessonDone) next.done = true;
    return { progress: next, lessonDone };
  }

  next.fails[stepId] = (next.fails[stepId] ?? 0) + 1;
  let added: Step | undefined;
  if (next.fails[stepId] >= STALL_AFTER) {
    const vis = visibleSteps(lesson, p).find((v) => v.step.id === stepId);
    if (vis) {
      const parent = lesson.steps.find((s) => s.id === vis.parentId)!;
      const smaller = 'smaller' in parent && parent.smaller ? parent.smaller : [];
      const k = next.inserted[parent.id] ?? 0;
      // only grow when stuck on the currently-easiest visible step for this parent
      const easiestId = k === 0 ? parent.id : smaller[k - 1]?.id;
      if (stepId === easiestId && k < smaller.length) {
        next.inserted[parent.id] = k + 1;
        added = smaller[k];
        next.fails[stepId] = 0;
      }
    }
  }
  return { progress: next, added, lessonDone: false };
}

/** Lesson n is open once lesson n-1 is done (lesson 1 always open). */
export function isUnlocked(id: number, all: Record<number, LessonProgress>) {
  return id === 1 || !!all[id - 1]?.done;
}

export function nextLessonId(all: Record<number, LessonProgress>): number {
  const l = LESSONS.find((x) => !all[x.id]?.done);
  return l ? l.id : LESSONS[LESSONS.length - 1].id;
}
