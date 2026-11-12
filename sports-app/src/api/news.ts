import type { TeamConfig } from '../teams';
import { ESPN } from './espn';
import { getJson } from './http';

export interface Article {
  id: string;
  headline: string;
  description?: string;
  published: string;
  url?: string;
  image?: string;
  kind?: 'Video' | 'Recap' | 'Preview';
  byline?: string;
  premium: boolean;
}

/** League-wide pieces (power rankings, uniform roundups) tag most teams; beyond this many we need a mention. */
const MAX_TAGGED = 6;

const KIND: Record<string, Article['kind']> = { Media: 'Video', Recap: 'Recap', Preview: 'Preview' };

/** Shrink ESPN photos through their resizer: thumbnails are ~7 KB instead of ~800 KB. */
export function thumb(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/^https?:\/\/a\.espncdn\.com(\/photo\/.+)$/);
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=240&h=160&scale=crop` : url;
}

export function parseNews(json: any, team: TeamConfig): Article[] {
  const names = [team.short, team.name].map((s) => s.toLowerCase());
  const out: Article[] = [];
  for (const a of json.articles ?? []) {
    if (!a?.headline) continue;
    const tagged = (a.categories ?? []).filter((c: any) => c.type === 'team').length;
    const text = `${a.headline} ${a.description ?? ''}`.toLowerCase();
    if (tagged > MAX_TAGGED && !names.some((n) => text.includes(n))) continue;
    out.push({
      id: String(a.id ?? a.headline),
      headline: a.headline,
      description: a.description && a.description.trim() !== a.headline.trim() ? a.description : undefined,
      published: a.published ?? a.lastModified,
      url: a.links?.web?.href ?? a.links?.mobile?.href,
      image: thumb(a.images?.[0]?.url),
      kind: KIND[a.type],
      byline: a.byline || undefined,
      premium: !!a.premium,
    });
  }
  return out.sort((x, y) => Date.parse(y.published) - Date.parse(x.published));
}

export async function teamNews(team: TeamConfig): Promise<Article[]> {
  const e = team.espn;
  if (!e) return [];
  const json = await getJson(`${ESPN}/${e.sport}/${e.league}/news?team=${e.abbr}&limit=40`);
  return parseNews(json, team);
}

/** "5m", "3h", "Yesterday", "Nov 9". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  if (hrs < 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}
