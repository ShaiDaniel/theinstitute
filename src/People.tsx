// Members the viewer may see, linking to their showcases.
import { useEffect, useState } from 'react';
import { useSession } from './auth';
import { useI18n } from './i18n';
import { listMembers, type Member } from './members';
import { hrefOf } from './route';

export function People() {
  const { t } = useI18n();
  const { ready, member: me } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    listMembers(me !== null)
      .then((m) => live && setMembers(m))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [ready, me]);

  if (error) return <main className="placeholder">{t('loadError')}</main>;
  if (!members) return <main className="placeholder">{t('loading')}</main>;
  if (members.length === 0) return <main className="placeholder">{t('noMembers')}</main>;

  return (
    <main>
      <ul className="people">
        {members.map((m) => (
          <li key={m.uid}>
            <a href={hrefOf({ page: 'member', uid: m.uid })}>
              {m.photo ? <img className="avatar" src={m.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}
              <span>{m.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
