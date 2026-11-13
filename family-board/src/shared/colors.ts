/** Color helpers for person colors chosen in settings. */

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on the given color. */
export function textOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#141a24') ? '#ffffff' : '#141a24';
}

/** A warning to show in settings when a color will be hard to read, or null. */
export function colorWarning(hex: string): string | null {
  if (!isHexColor(hex)) return 'Use a color like #2F6FB5.';
  if (contrastRatio(hex, '#ffffff') < 2.2) return 'This color is very light, so times shown in it will be hard to read on the light theme.';
  if (contrastRatio(hex, '#181e29') < 2.2) return 'This color is very dark, so it will be hard to see on the dark theme.';
  return null;
}

/** Suggested swatches for the color picker; all readable on both themes. */
export const SWATCHES = [
  '#2F6FB5', '#C23A72', '#23865B', '#C67C00', '#6B53C7', '#D2502D',
  '#0F8A8A', '#8A5A2B', '#B03A9E', '#4C7A1E', '#3554D1', '#A1452F',
];
