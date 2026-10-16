// Debates: a members-only discussion thread on every album, band, song and concert page.
// Stored at items/{itemId with ':' as '~'}/comments (see firestore.rules).
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, type Timestamp } from 'firebase/firestore/lite';
import { useEffect, useState } from 'react';
import { useSession } from './auth';
import { db, signIn } from './firebase';
import { useI18n } from './i18n';
import { hrefOf } from './route';

export const COMMENT_MAX = 1000;

interface Comment {
  id: string;
  uid: string;
  name: string;
  photo: string | null;
  text: string;
  at: Date | null;
}

const comments = (itemId: string) => collection(db, 'items', itemId.replace(':', '~'), 'comments');

export function Debate({ itemId }: { itemId: string }) {
  const { t, lang } = useI18n();
  const { user, member } = useSession();
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const snap = await getDocs(query(comments(itemId), orderBy('createdAt')));
    setList(
      snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, uid: x.uid, name: x.name, photo: x.photo ?? null, text: x.text, at: (x.createdAt as Timestamp | null)?.toDate() ?? null };
      }),
    );
  };

  useEffect(() => {
    if (member) load().catch(() => setList([]));
  }, [itemId, member]);

  if (!user || !member) {
    return (
      <section className="debate">
        <h3>{t('debate')}</h3>
        <p className="muted small">{t('debateMembers')}</p>
        {!user && (
          <button type="button" className="btn" onClick={() => signIn().catch(() => {})}>
            {t('signIn')}
          </button>
        )}
      </section>
    );
  }

  const post = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await addDoc(comments(itemId), { uid: user.uid, name: member.name.slice(0, 60), photo: member.photo, text: text.trim().slice(0, COMMENT_MAX), createdAt: serverTimestamp() });
      setText('');
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment) => {
    if (!confirm(t('debateDeleteConfirm'))) return;
    await deleteDoc(doc(comments(itemId), c.id)).catch(() => setFailed(true));
    await load();
  };

  return (
    <section className="debate">
      <h3>
        {t('debate')} {list && list.length > 0 && <span className="muted small">· {list.length}</span>}
      </h3>
      {list === null ? (
        <p className="muted small">{t('loading')}</p>
      ) : list.length === 0 ? (
        <p className="muted small">{t('debateEmpty')}</p>
      ) : (
        <ul className="comments">
          {list.map((c) => (
            <li key={c.id}>
              {c.photo ? <img className="avatar" src={c.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}
              <div className="entry-main">
                <div>
                  <a className="name" href={hrefOf({ page: 'member', uid: c.uid })}>
                    {c.name}
                  </a>{' '}
                  <span className="muted small">
                    {c.at?.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  {c.uid === user.uid && (
                    <button type="button" className="link danger" onClick={() => remove(c)}>
                      {t('remove')}
                    </button>
                  )}
                </div>
                <p className="note" dir="auto">
                  {c.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="debate-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) post();
        }}
      >
        <textarea rows={3} maxLength={COMMENT_MAX} value={text} placeholder={t('debatePlaceholder')} dir="auto" onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
            {t('debatePost')}
          </button>
          {failed && <span className="error">{t('saveError')}</span>}
        </div>
      </form>
    </section>
  );
}
