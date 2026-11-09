import { useSyncExternalStore } from 'react';

/**
 * Tiny localStorage-backed store. Every read/write is wrapped so the app still
 * works (just without saving) if storage is blocked.
 */
export function createStore<T extends object>(key: string, defaults: T) {
  let state: T = load();
  const listeners = new Set<() => void>();

  function load(): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable */
    }
    return { ...defaults };
  }

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }

  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      save();
      listeners.forEach((l) => l());
    },
    reset() {
      state = { ...defaults };
      save();
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    use(): T {
      return useSyncExternalStore(this.subscribe, this.get, this.get);
    },
    defaults,
  };
}
