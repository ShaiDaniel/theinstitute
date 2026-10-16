// The signed-in member's own settings: their name and who can see their page.
import { useEffect, useState } from 'react';
import { useSession } from './auth';
import { signIn } from './firebase';
import { useI18n } from './i18n';
import { deleteMember, NAME_MAX, saveMember, type Visibility } from './members';

export function Profile() {
  const { t } = useI18n();
  const { ready, user, member, reloadMember } = useSession();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('members');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    setName(member?.name ?? user?.displayName ?? '');
    setVisibility(member?.visibility ?? 'members');
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
    setStatus(null);
    try {
      await action();
      await reloadMember();
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => saveMember(user.uid, { name, photo: user.photoURL, visibility }, member !== null));
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

      <fieldset className="field">
        <legend>{t('whoCanSee')}</legend>
        {(['public', 'members'] as const).map((v) => (
          <label key={v} className="choice">
            <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
            <span>
              <strong>{t(v === 'public' ? 'visPublic' : 'visMembers')}</strong>
              <span className="muted"> — {t(v === 'public' ? 'visPublicHint' : 'visMembersHint')}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={save}>
          {member ? t('save') : t('create')}
        </button>
        {member && (
          <button type="button" className="btn danger" disabled={busy} onClick={remove}>
            {t('deleteProfile')}
          </button>
        )}
        {status && <span className={status === 'error' ? 'error' : 'muted'}>{t(status === 'error' ? 'saveError' : 'saved')}</span>}
      </div>
    </main>
  );
}
