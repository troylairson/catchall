import { useEffect, useState } from 'react';
import type { TeamConfig } from '../teams';
import { ago, teamNews, type Article } from '../api/news';

export function News({ team }: { team: TeamConfig }) {
  const [articles, setArticles] = useState<Article[]>();
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let stop = false;
    setArticles(undefined);
    setError(undefined);
    teamNews(team)
      .then((a) => !stop && setArticles(a))
      .catch((e) => !stop && setError(String((e as Error).message ?? e)));
    return () => {
      stop = true;
    };
  }, [team.key]);

  if (error) return <div className="card error">Couldn’t load news. Check your connection and try again.</div>;
  if (!articles) return <div className="card skeleton tall" />;
  if (!articles.length) return <div className="card muted">No {team.short} news right now.</div>;

  const shown = showAll ? articles : articles.slice(0, 12);
  return (
    <>
      <ol className="feed card flush news">
        {shown.map((a) => (
          <li key={a.id}>
            <a className="article" href={a.url} target="_blank" rel="noopener noreferrer">
              <span className="article-main">
                <span className="article-meta small">
                  {a.kind && <span className="tag">{a.kind}</span>}
                  {a.premium && <span className="tag">ESPN+</span>}
                  <span className="muted">{ago(a.published)}</span>
                </span>
                <span className="article-head">{a.headline}</span>
                {a.description && <span className="article-desc small muted">{a.description}</span>}
              </span>
              {a.image && (
                <img
                  className="article-img"
                  src={a.image}
                  alt=""
                  loading="lazy"
                  width={96}
                  height={64}
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
            </a>
          </li>
        ))}
      </ol>
      {articles.length > shown.length && (
        <button className="btn wide" onClick={() => setShowAll(true)}>
          More {team.short} news
        </button>
      )}
      <p className="muted small source">News from ESPN</p>
    </>
  );
}
