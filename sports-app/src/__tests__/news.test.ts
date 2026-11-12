import { describe, expect, it } from 'vitest';
import news from './fixtures/espn-nfl-news.json';
import { ago, parseNews, thumb } from '../api/news';
import { teamByKey } from '../teams';

describe('team news', () => {
  const steelers = teamByKey('nfl-pit')!;
  const articles = parseNews(news, steelers);
  const heads = articles.map((a) => a.headline);

  it('keeps team stories and drops league-wide roundups that never mention the team', () => {
    expect(heads).toContain('Longtime Steelers player, assistant coach Dick Hoak dies at 86');
    expect(heads).toContain('Who has the edge in Steelers-Bengals?');
    expect(heads.some((h) => h.startsWith('NFL Week 10 uniforms'))).toBe(false);
    expect(heads.some((h) => h.startsWith('NFL trade deadline grades'))).toBe(false);
  });

  it('newest first, with link, small thumbnail and video label', () => {
    const times = articles.map((a) => Date.parse(a.published));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const video = articles.find((a) => a.headline.includes('Steelers-Bengals'))!;
    expect(video.kind).toBe('Video');
    expect(video.url).toMatch(/^https:\/\/www\.espn\.com\//);
    expect(articles[0].image).toMatch(/^https:\/\/a\.espncdn\.com\/combiner\/i\?img=\/photo\//);
  });

  it('formats thumbnails and ages', () => {
    expect(thumb('https://a.espncdn.com/photo/2026/1111/x.jpg')).toBe('https://a.espncdn.com/combiner/i?img=/photo/2026/1111/x.jpg&w=240&h=160&scale=crop');
    expect(thumb('https://other.example/x.jpg')).toBe('https://other.example/x.jpg');
    const now = Date.parse('2026-11-12T18:00:00Z');
    expect(ago('2026-11-12T17:55:00Z', now)).toBe('5m ago');
    expect(ago('2026-11-12T15:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-11-11T12:00:00Z', now)).toBe('Yesterday');
    expect(ago('2026-11-08T12:00:00Z', now)).toBe('Nov 8');
  });
});

describe('news cleanup', () => {
  it('drops a description that just repeats the headline (video clips)', () => {
    const [a] = parseNews({ articles: [{ id: 1, headline: 'Who has the edge?', description: 'Who has the edge?', published: '2026-11-12T00:00:00Z' }] }, teamByKey('nfl-pit')!);
    expect(a.description).toBeUndefined();
  });
});
