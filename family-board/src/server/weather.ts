/** Current weather from Open-Meteo (free, no key), cached for 30 minutes. */

import type { Settings, Weather } from '../shared/types';

const CODES: Array<[number[], string]> = [
  [[0], 'Clear'], [[1], 'Mostly clear'], [[2], 'Partly cloudy'], [[3], 'Cloudy'],
  [[45, 48], 'Fog'], [[51, 53, 55, 56, 57], 'Drizzle'], [[61, 63, 65, 66, 67], 'Rain'],
  [[71, 73, 75, 77], 'Snow'], [[80, 81, 82], 'Rain showers'], [[85, 86], 'Snow showers'],
  [[95, 96, 99], 'Thunderstorms'],
];

function describe(code: number): string {
  return CODES.find(([codes]) => codes.includes(code))?.[1] ?? '';
}

let cache: { key: string; at: number; value: Weather | null } | null = null;

export async function getWeather(s: Settings): Promise<Weather | null> {
  const key = `${s.latitude},${s.longitude}`;
  if (cache && cache.key === key && Date.now() - cache.at < 30 * 60_000) return cache.value;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.latitude}&longitude=${s.longitude}`
      + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min'
      + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1';
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const j = await res.json() as {
      current: { temperature_2m: number; weather_code: number };
      daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    const value: Weather = {
      temperature: Math.round(j.current.temperature_2m),
      high: Math.round(j.daily.temperature_2m_max[0]),
      low: Math.round(j.daily.temperature_2m_min[0]),
      description: describe(j.current.weather_code),
      fetchedAt: new Date().toISOString(),
    };
    cache = { key, at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn('Weather unavailable:', (err as Error).message);
    // Keep showing the last reading; retry in 5 minutes.
    const stale = cache?.key === key ? cache.value : null;
    cache = { key, at: Date.now() - 25 * 60_000, value: stale };
    return stale;
  }
}
