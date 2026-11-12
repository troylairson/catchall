import { useState } from 'react';

/** Best-guess dark-background variant of a known logo URL. */
export function darkVariant(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.includes('a.espncdn.com/i/teamlogos/') && !url.includes('-dark/')) return url.replace(/\/500\//, '/500-dark/');
  if (url.includes('assets.nhle.com') && url.includes('_light.svg')) return url.replace('_light.svg', '_dark.svg');
  const m = url.match(/mlbstatic\.com\/team-logos\/(\d+)\.svg$/);
  if (m) return `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${m[1]}.svg`;
  return undefined;
}

export function Logo({ src, dark, alt, size = 36 }: { src?: string; dark?: string; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="logo logo-fallback" style={{ width: size, height: size, fontSize: size * 0.32 }} aria-label={alt}>
        {alt.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  const d = dark ?? darkVariant(src);
  return (
    <picture>
      {d && <source srcSet={d} media="(prefers-color-scheme: dark)" />}
      <img className="logo" src={src} alt={alt} width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
    </picture>
  );
}
