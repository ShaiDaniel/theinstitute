// On another member's page: how close your taste is to theirs, and where you disagree most.
import { useEffect, useState } from 'react';
import { useSession } from './auth';
import { useI18n } from './i18n';
import { hrefOf } from './route';
import { fmtScore } from './Showcase';
import { allEntries, MIN_COMMON, tasteMatch, type Match } from './taste';

const avgFmt = (n: number) => fmtScore(Math.round(n * 2) / 2);

export function TasteMatch({ uid }: { uid: string }) {
  const { t } = useI18n();
  const { user } = useSession();
  const [match, setMatch] = useState<Match | null | 'loading'>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    Promise.all([allEntries(user.uid, 'owner'), allEntries(uid, 'member')])
      .then(([mine, theirs]) => live && setMatch(tasteMatch(mine, theirs)))
      .catch(() => live && setMatch(null));
    return () => {
      live = false;
    };
  }, [user, uid]);

  if (match === 'loading' || match === null) return null;
  if (Number.isNaN(match.percent)) {
    return <p className="taste muted small">{t('tasteFew').replace('{n}', String(match.common.length)).replace('{min}', String(MIN_COMMON))}</p>;
  }
  return (
    <section className="taste">
      <button type="button" className="taste-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="score big">{match.percent}%</span>
        <span>
          {t('tasteMatch')}
          <span className="muted small">
            {' '}
            · {match.common.length} {t('tasteInCommon')}
          </span>
        </span>
      </button>
      {open && (
        <table className="taste-table">
          <thead>
            <tr>
              <th>{t('tasteItem')}</th>
              <th>{t('tasteYou')}</th>
              <th>{t('tasteThem')}</th>
            </tr>
          </thead>
          <tbody>
            {match.common.map((c) => (
              <tr key={c.itemId}>
                <td>
                  <a href={hrefOf({ page: 'item', itemId: c.itemId })}>{c.title}</a>
                  {c.artist && <span className="muted small"> · {c.artist}</span>}
                </td>
                <td className="num">{avgFmt(c.mine)}</td>
                <td className="num">{avgFmt(c.theirs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
