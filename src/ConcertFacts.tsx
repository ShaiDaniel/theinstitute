// A concert's shared facts on its page: where it was, the setlist, and a setlist.fm link.
// Any member can correct them (wiki-style, see concerts.ts); visitors only read.
import { useState } from 'react';
import { useSession } from './auth';
import { PLACE_MAX, SETLIST_MAX, updateConcert, validSetlistUrl, type Concert, type ConcertPlace } from './concerts';
import { useI18n, type StringKey } from './i18n';

export function ConcertFacts({ concert, onChange }: { concert: Concert; onChange: (c: Concert) => void }) {
  const { t } = useI18n();
  const { user, member } = useSession();
  const canEdit = Boolean(user && member);
  const [editing, setEditing] = useState<'place' | 'setlist' | null>(null);

  return (
    <section className="concert-facts">
      {editing === 'place' ? (
        <PlaceForm concert={concert} onDone={(c) => (c && onChange(c), setEditing(null))} />
      ) : (
        <p className="place-line">
          {[concert.venue, concert.city, concert.country].filter(Boolean).join(', ')}
          {canEdit && (
            <button type="button" className="link" onClick={() => setEditing('place')}>
              {t('editPlace')}
            </button>
          )}
        </p>
      )}

      <h3>{t('setlist')}</h3>
      {editing === 'setlist' ? (
        <SetlistForm concert={concert} onDone={(c) => (c && onChange(c), setEditing(null))} />
      ) : (
        <>
          {concert.setlist.length === 0 ? (
            <p className="muted small">{t('setlistEmpty')}</p>
          ) : (
            <ol className="setlist">
              {concert.setlist.map((song, i) => (
                <li key={i}>{song}</li>
              ))}
            </ol>
          )}
          <p className="row small">
            {concert.setlistUrl && (
              <a href={concert.setlistUrl} target="_blank" rel="noreferrer">
                {t('onSetlistFm')}
              </a>
            )}
            {canEdit && (
              <button type="button" className="link" onClick={() => setEditing('setlist')}>
                {t('editSetlist')}
              </button>
            )}
          </p>
        </>
      )}
      {canEdit && <p className="muted small">{t('membersCanEdit')}</p>}
    </section>
  );
}

function useSave(concert: Concert, onDone: (c: Concert | null) => void) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const save = async (change: Parameters<typeof updateConcert>[2], next: Concert) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await updateConcert(user.uid, concert.id, change);
      onDone(next);
    } catch {
      setError('saveError');
      setBusy(false);
    }
  };
  return { busy, error, setError, save };
}

function PlaceForm({ concert, onDone }: { concert: Concert; onDone: (c: Concert | null) => void }) {
  const { t } = useI18n();
  const [place, setPlace] = useState<ConcertPlace>({ venue: concert.venue, city: concert.city, country: concert.country });
  const { busy, error, save } = useSave(concert, onDone);
  const field = (key: keyof ConcertPlace, label: StringKey) => (
    <label className="field">
      <span>{t(label)}</span>
      <input value={place[key]} maxLength={PLACE_MAX} onChange={(e) => setPlace({ ...place, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="panel">
      <div className="place">
        {field('venue', 'venue')}
        {field('city', 'city')}
        {field('country', 'country')}
      </div>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !place.venue.trim()} onClick={() => save({ place }, { ...concert, ...place })}>
          {t('save')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
          {t('cancel')}
        </button>
        {error && <span className="error">{t(error)}</span>}
      </div>
    </div>
  );
}

function SetlistForm({ concert, onDone }: { concert: Concert; onDone: (c: Concert | null) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(concert.setlist.join('\n'));
  const [url, setUrl] = useState(concert.setlistUrl ?? '');
  const { busy, error, setError, save } = useSave(concert, onDone);
  const submit = () => {
    const link = url.trim();
    if (link && !validSetlistUrl(link)) return setError('setlistLinkInvalid');
    const setlist = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, SETLIST_MAX);
    save({ setlist, setlistUrl: link || null }, { ...concert, setlist, setlistUrl: link || null });
  };
  return (
    <div className="panel">
      <label className="field">
        <span>{t('setlist')}</span>
        <textarea rows={10} value={text} placeholder={t('setlistPlaceholder')} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('setlistLink')}</span>
        <input type="url" value={url} placeholder="https://www.setlist.fm/setlist/…" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={submit}>
          {t('save')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>
          {t('cancel')}
        </button>
        {error && <span className="error">{t(error)}</span>}
      </div>
    </div>
  );
}
