// The home page: numbers about everything the group has ranked (see stats.ts).
import { useEffect, useState } from 'react';
import { useSession } from './auth';
import { signIn } from './firebase';
import { useI18n } from './i18n';
import { KINDS, type Kind } from './music';
import { hrefOf } from './route';
import { fmtScore, Picture, useSubtitle } from './Showcase';
import { loadStats, type Recent, type StatItem, type Stats } from './stats';

const sum = (r: Record<Kind, number>) => KINDS.reduce((a, k) => a + (r[k] ?? 0), 0);

export function Home() {
  const { t, lang } = useI18n();
  const { ready, user, member } = useSession();
  const [stats, setStats] = useState<Stats | null | 'none' | 'error'>(null);
  const [kind, setKind] = useState<Kind>('album');

  useEffect(() => {
    if (!ready) return;
    let live = true;
    loadStats(member !== null)
      .then((s) => live && setStats(s ?? 'none'))
      .catch(() => live && setStats('error'));
    return () => {
      live = false;
    };
  }, [ready, member]);

  // Visitors get a line about the site and the sign-in button; members go straight to the numbers.
  const intro =
    ready && !user ? (
      <section className="intro">
        <p>{t('showcaseIntro')}</p>
        <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
          {t('signIn')}
        </button>
      </section>
    ) : null;

  if (stats === null) return <main>{intro}</main>;
  if (stats === 'error' || stats === 'none')
    return (
      <main>
        {intro}
        <p className="placeholder">{t(stats === 'error' ? 'loadError' : 'statsNotYet')}</p>
      </main>
    );

  const { totals } = stats;
  const maxTag = Math.max(1, ...stats.tags.map((x) => x.count));
  const maxDecade = Math.max(1, ...stats.decades.map((x) => x.count));
  const fmt = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');

  return (
    <main className="home">
      {intro}

      <section className="tiles">
        <Tile value={fmt(totals.members)} label={t('statMembers')} />
        <Tile value={fmt(sum(totals.lists))} label={t('statLists')} />
        {KINDS.map((k) => (
          <Tile key={k} value={fmt(totals.entries[k] ?? 0)} label={t(k)} sub={`${fmt(totals.distinct[k] ?? 0)} ${t('statDifferent')}`} />
        ))}
      </section>

      {stats.recent.length > 0 && (
        <section className="feed">
          <h3>{t('feedTitle')}</h3>
          <Feed items={stats.recent} />
        </section>
      )}

      <nav className="segmented kinds">
        {KINDS.map((k) => (
          <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {t(k)}
          </button>
        ))}
      </nav>

      <div className="columns">
        <section>
          <h3>{t('statMostRanked')}</h3>
          <TopList items={stats.mostRanked[kind] ?? []} metric={(i) => `${i.lists} ${t(i.lists === 1 ? 'oneList' : 'listsCount')}`} empty={t('statEmpty')} />
        </section>
        <section>
          <h3>{t('statTopScored')}</h3>
          <p className="muted small">{t('statTopScoredHint').replace('{n}', String(stats.minMembers))}</p>
          <TopList items={stats.topScored[kind] ?? []} metric={(i) => fmtScore(i.average)} score empty={t('statTopEmpty')} />
        </section>
      </div>

      <section className="divisive">
        <h3>{t('statDivisive')}</h3>
        <p className="muted small">{t('statDivisiveHint').replace('{n}', String(stats.minMembers))}</p>
        <TopList
          items={stats.divisive?.[kind] ?? []}
          metric={(i) => `${fmtScore(i.low ?? 0)}–${fmtScore(i.high ?? 0)}`}
          empty={t('statTopEmpty')}
        />
      </section>

      <div className="columns">
        <section>
          <h3>{t('statTags')}</h3>
          {stats.tags.length === 0 ? (
            <p className="muted small">{t('statEmpty')}</p>
          ) : (
            <Bars rows={stats.tags.map((x) => ({ label: t(`tag_${x.tag}`), value: x.count, max: maxTag, display: fmt(x.count) }))} />
          )}
        </section>
        <section>
          <h3>{t('statDecades')}</h3>
          {stats.decades.length === 0 ? (
            <p className="muted small">{t('statEmpty')}</p>
          ) : (
            <Bars rows={stats.decades.map((x) => ({ label: `${x.decade}s`, value: x.count, max: maxDecade, display: fmt(x.count) }))} />
          )}
        </section>
      </div>

      {stats.computedAt && (
        <p className="muted small updated">
          {t('statUpdated')} {stats.computedAt.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}
    </main>
  );
}

/** "3 hours ago", in the page's language. */
function useAgo() {
  const { lang } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(lang === 'he' ? 'he' : 'en', { numeric: 'auto' });
  return (d: Date) => {
    const minutes = Math.round((d.getTime() - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return rtf.format(days, 'day');
    return d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
}

function Feed({ items }: { items: Recent[] }) {
  const { t } = useI18n();
  const ago = useAgo();
  const subtitle = useSubtitle();
  return (
    <ul className="feed-list">
      {items.map((r) => (
        <li key={`${r.listId}/${r.itemId}`}>
          <a className="who" href={hrefOf({ page: 'member', uid: r.uid })} title={r.member}>
            {r.photo ? <img className="avatar" src={r.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}
          </a>
          <Picture src={r.image} kind={r.kind} size={40} />
          <div className="entry-main">
            <div>
              <a className="name" href={hrefOf({ page: 'member', uid: r.uid })}>
                {r.member}
              </a>{' '}
              <span className="muted">{t('feedAdded')}</span>{' '}
              <a className="title" href={hrefOf({ page: 'item', itemId: r.itemId })}>
                {r.title}
              </a>{' '}
              <span className="muted">{t('feedTo')}</span>{' '}
              <a href={hrefOf({ page: 'list', uid: r.uid, listId: r.listId })}>{r.listName}</a>
            </div>
            <div className="muted small">
              {subtitle(r)} · {ago(r.at)}
            </div>
          </div>
          <span className="score">{fmtScore(r.score)}</span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

function TopList({ items, metric, score, empty }: { items: StatItem[]; metric: (i: StatItem) => string; score?: boolean; empty: string }) {
  const subtitle = useSubtitle();
  if (items.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ol className="top-list">
      {items.map((i, n) => (
        <li key={i.itemId}>
          <span className="rank">{n + 1}</span>
          <Picture src={i.image} kind={i.kind} size={40} />
          <a className="entry-main" href={hrefOf({ page: 'item', itemId: i.itemId })}>
            <span className="title">{i.title}</span>
            <span className="muted small">{subtitle(i)}</span>
          </a>
          <span className={score ? 'score' : 'muted small'}>{metric(i)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Horizontal bars, one series: the bar length is the value, the number is printed beside it. */
function Bars({ rows }: { rows: { label: string; value: number; max: number; display: string }[] }) {
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.display}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar" style={{ width: `${Math.max(2, (r.value / r.max) * 100)}%` }} />
          </span>
          <span className="bar-value">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}
