import { useSession } from './auth';
import { signIn, signOut } from './firebase';
import { useI18n, type StringKey } from './i18n';
import { Profile } from './Profile';
import { hrefOf, useRoute, type Page } from './route';

const TABS = ['showcase', 'people', 'chat', 'about'] as const;
const INTRO: Record<(typeof TABS)[number], StringKey> = {
  showcase: 'showcaseIntro',
  people: 'peopleIntro',
  chat: 'chatIntro',
  about: 'aboutIntro',
};

export function App() {
  const { lang, setLang, t } = useI18n();
  const { ready, user, member } = useSession();
  const page: Page = useRoute();

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>
            <a href="#/">The Institute</a>
          </h1>
          <p className="muted">{t('tagline')}</p>
        </div>
        <div className="top-actions">
          <nav className="segmented" aria-label="Language">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button type="button" className={lang === 'he' ? 'active' : ''} onClick={() => setLang('he')}>
              עב
            </button>
          </nav>
          {ready &&
            (user ? (
              <>
                <a className="me" href={hrefOf('me')} title={t('yourProfile')}>
                  {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
                  <span>{member?.name || user.displayName}</span>
                </a>
                <button type="button" className="btn" onClick={() => signOut()}>
                  {t('signOut')}
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
                {t('signIn')}
              </button>
            ))}
        </div>
      </header>

      {ready && user && !member && page !== 'me' && (
        <a className="notice" href={hrefOf('me')}>
          {t('finishProfile')}
        </a>
      )}

      <nav className="tabs">
        {TABS.map((id) => (
          <a key={id} href={hrefOf(id)} className={`tab ${page === id ? 'active' : ''}`}>
            {t(id)}
          </a>
        ))}
      </nav>

      {page === 'me' ? (
        <Profile />
      ) : (
        <main className="placeholder">
          <p>{t(INTRO[page])}</p>
          <span className="badge">{t('comingSoon')}</span>
        </main>
      )}
    </div>
  );
}
