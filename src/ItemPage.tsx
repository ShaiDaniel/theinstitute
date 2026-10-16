// One album, band or song: its picture and facts, and every shared list it is in, with that list's
// rank, score, tags and note. A member with it in several lists counts once in the average (their
// own average across those lists).
import { useEffect, useState } from 'react';
import { ConcertFacts } from './ConcertFacts';
import { Debate } from './Debate';
import { concertIdOf, loadConcert, type Concert } from './concerts';
import { useSession } from './auth';
import { loadEntries, loadList, whoRanked, type Entry, type List } from './entries';
import { useI18n } from './i18n';
import { listMembers, type Member } from './members';
import { details, type Details } from './music';
import { hrefOf } from './route';
import { fmtScore, Picture, TagChips, useSubtitle } from './Showcase';

interface Placement {
  entry: Entry;
  list: List | null;
  rank: number;
}
interface ByMember {
  uid: string;
  member: Member | undefined;
  placements: Placement[];
  average: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function ItemPage({ itemId }: { itemId: string }) {
  const { t, lang } = useI18n();
  const { ready, member: me } = useSession();
  const [rows, setRows] = useState<ByMember[] | null>(null);
  const [info, setInfo] = useState<Details | null>(null);
  const [error, setError] = useState(false);
  const [concert, setConcert] = useState<Concert | null>(null);
  const subtitle = useSubtitle();
  const isConcert = itemId.startsWith('concert:');

  // Concerts have shared facts of their own (venue, setlist), shown even before anyone shares one.
  useEffect(() => {
    if (!isConcert) return;
    let live = true;
    loadConcert(concertIdOf(itemId))
      .then((c) => live && setConcert(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [itemId, isConcert]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    setRows(null);
    setError(false);
    (async () => {
      try {
        const viewer = me ? 'member' : 'visitor';
        const [found, members] = await Promise.all([whoRanked(itemId, viewer), listMembers(me !== null)]);
        const placements = await Promise.all(
          found.map(async (entry): Promise<Placement> => {
            const [list, all] = await Promise.all([loadList(entry.uid, entry.listId), loadEntries(entry.uid, entry.listId, viewer)]);
            return { entry, list, rank: all.findIndex((e) => e.itemId === itemId) + 1 };
          }),
        );
        const uids = [...new Set(placements.map((p) => p.entry.uid))];
        const byMember = uids.map((uid) => {
          const mine = placements.filter((p) => p.entry.uid === uid).sort((a, b) => a.rank - b.rank);
          return { uid, member: members.find((m) => m.uid === uid), placements: mine, average: mean(mine.map((p) => p.entry.score)) };
        });
        if (live) setRows(byMember.sort((a, b) => b.average - a.average));
      } catch {
        if (live) setError(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [itemId, ready, me]);

  const first =
    rows?.[0]?.placements[0]?.entry ??
    (concert
      ? {
          kind: 'concert' as const,
          itemId,
          title: concert.band,
          artist: [concert.venue, concert.city].filter(Boolean).join(', '),
          year: Number(concert.date.slice(0, 4)),
          image: concert.image,
          ref: concert.id,
        }
      : undefined);
  useEffect(() => {
    if (!first) return;
    let live = true;
    setInfo(null);
    details(first.itemId, first.ref, lang)
      .then((d) => live && setInfo(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [first?.itemId, first?.ref, lang]);

  if (error) return <main className="placeholder">{t('loadError')}</main>;
  if (!rows) return <main className="placeholder">{t('loading')}</main>;
  if (!first) return <main className="placeholder">{t('nobodyRanked')}</main>;

  const avg = rows.length ? mean(rows.map((r) => r.average)) : null;

  return (
    <main className="item">
      <header className="item-head">
        <Picture src={first.image} kind={first.kind} size={160} />
        <div>
          <p className="muted small">{t(`one_${first.kind}`)}</p>
          <h2>{first.title}</h2>
          <p className="muted">{subtitle(first)}</p>
          {avg !== null && (
            <p className="avg">
              <span className="score big">{avg.toFixed(1)}</span>
              <span className="muted small">
                {' '}
                {t('average')} · {rows.length} {t(rows.length === 1 ? 'oneMember' : 'membersCount')}
              </span>
            </p>
          )}
          {info?.preview && <audio controls preload="none" src={info.preview} aria-label={t('preview')} />}
        </div>
      </header>

      {info?.summary && (
        <section className="summary">
          <p>{info.summary}</p>
          {info.wikiUrl && (
            <a href={info.wikiUrl} target="_blank" rel="noreferrer">
              {t('readMore')}
            </a>
          )}
        </section>
      )}

      {concert && <ConcertFacts concert={concert} onChange={setConcert} />}

      <h3>{t(isConcert ? 'whoWasThere' : 'whoRanked')}</h3>
      {rows.length === 0 && <p className="muted small">{t('nobodyRanked')}</p>}
      <ul className="rankings">
        {rows.map(({ uid, member, placements }) => (
          <li key={uid} className="ranking">
            <a className="who" href={hrefOf({ page: 'member', uid })}>
              {member?.photo ? <img className="avatar" src={member.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}
              <strong>{member?.name ?? '?'}</strong>
            </a>
            {placements.map(({ entry, list, rank }) => (
              <div key={entry.listId} className="entry">
                <span className="rank">{rank}</span>
                <div className="entry-main">
                  <a className="title" href={hrefOf({ page: 'list', uid, listId: entry.listId })}>
                    {list?.name ?? '?'}
                  </a>
                  {entry.tags.length > 0 && (
                    <div className="chips">
                      <TagChips tags={entry.tags} />
                    </div>
                  )}
                  {entry.note && <p className="note">{entry.note}</p>}
                </div>
                <span className="score">{fmtScore(entry.score)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <Debate itemId={itemId} />

      {info && info.links.length > 0 && (
        <p className="muted small links">
          {info.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </p>
      )}
    </main>
  );
}
