// The signed-in member's own settings: their name and who can see their page.
import { useEffect, useState } from 'react';
import { DataBackup } from './DataBackup';
import { useSession } from './auth';
import { signIn } from './firebase';
import { useI18n } from './i18n';
import { deleteMember, NAME_MAX, saveMember } from './members';
import { hrefOf } from './route';

export function Profile() {
  const { t } = useI18n();
  const { ready, user, member, reloadMember } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setName(member?.name ?? user?.displayName ?? '');
  }, [user, member]);

  if (!ready) return null;
  if (!user) {
    return (
      <main className="placeholder">
        <p>{t('signInToCreate')}</p>
        <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
          {t('signIn')}
        </button>
      </main>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      await reloadMember();
      // Done: back to the site (the header shows the saved name).
      location.hash = hrefOf('showcase');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const save = () => run(() => saveMember(user.uid, { name, photo: user.photoURL }, member));
  const remove = () => {
    if (confirm(t('deleteConfirm'))) run(() => deleteMember(user.uid));
  };

  return (
    <main className="panel profile">
      <h2>{member ? t('yourProfile') : t('createProfile')}</h2>
      {!member && <p className="muted">{t('createProfileIntro')}</p>}

      <label className="field">
        <span>{t('displayName')}</span>
        <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </label>

      <p className="muted small">{t('listsPrivacyHint')}</p>

      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={save}>
          {member ? t('save') : t('create')}
        </button>
        <a className="btn" href={hrefOf('showcase')}>
          {t('close')}
        </a>
        {member && (
          <button type="button" className="btn danger" disabled={busy} onClick={remove}>
            {t('deleteProfile')}
          </button>
        )}
        {failed && <span className="error">{t('saveError')}</span>}
      </div>

      {member && <DataBackup uid={user.uid} name={member.name} />}
    </main>
  );
}
