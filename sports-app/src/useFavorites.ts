import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadFavorites, saveFavorites, teamByKey, type TeamConfig } from './teams';

export function useFavorites() {
  const [keys, setKeys] = useState<string[]>(loadFavorites);
  useEffect(() => {
    const on = () => setKeys(loadFavorites());
    window.addEventListener('favorites-changed', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('favorites-changed', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const teams = useMemo(() => keys.map((k) => teamByKey(k)).filter(Boolean) as TeamConfig[], [keys]);
  const set = useCallback((next: string[]) => saveFavorites([...new Set(next)]), []);
  return {
    keys,
    teams,
    add: (k: string) => set([...keys, k]),
    remove: (k: string) => set(keys.filter((x) => x !== k)),
    move: (k: string, dir: -1 | 1) => {
      const i = keys.indexOf(k);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= keys.length) return;
      const next = [...keys];
      [next[i], next[j]] = [next[j], next[i]];
      set(next);
    },
  };
}
