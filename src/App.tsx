import { useEffect } from 'react';
import { useSession } from './auth';
import { ChatDockProvider, useChatDock } from './ChatDock';
import { signIn, signOut } from './firebase';
import { useI18n, type StringKey } from './i18n';
import { Home } from './Home';
import { ItemPage } from './ItemPage';
import { People } from './People';
import { Profile } from './Profile';
import { hrefOf, useRoute, type Route, type Tab } from './route';
import { ListPage, ShowcasePage } from './Showcase';

const TABS: Tab[] = ['home', 'showcase', 'people', 'chat', 'about'];
const INTRO: Record<'showcase' | 'about', StringKey> = {
  showcase: 'showcaseIntro',
  about: 'aboutIntro',
};

export function App() {
  return (
    <ChatDockProvider>
      <Site />
    </ChatDockProvider>
  );
}

function Site() {
  const { lang, setLang, t } = useI18n();
  const { ready, user, member } = useSession();
  const route = useRoute();
  const page = route.page;
  const dock = useChatDock();

  // The chat isn't a page: an old #/chat link opens it on top of the home page.
  useEffect(() => {
    if (route.page !== 'chat') return;
    dock.open();
    location.replace(`${location.pathname}${location.search}#/`);
  }, [route.page]);
  // Member and item pages belong under People; your own page under Showcase.
  const activeTab: Tab | null =
    route.page === 'member' || route.page === 'list' ? (route.uid === user?.uid ? 'showcase' : 'people') : route.page === 'item' || route.page === 'me' ? null : route.page;

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
        {TABS.map((id) =>
          id === 'chat' ? (
            // Opens and closes the chat over the current page.
            <button key={id} type="button" className={`tab ${dock.mode !== 'min' ? 'active' : ''}`} onClick={dock.toggle} aria-pressed={dock.mode !== 'min'}>
              {t(id)}
            </button>
          ) : (
            <a key={id} href={hrefOf(id)} className={`tab ${activeTab === id ? 'active' : ''}`}>
              {t(id)}
            </a>
          ),
        )}
      </nav>

      {ready && <Page route={route} />}
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const { t } = useI18n();
  const { user, member } = useSession();
  switch (route.page) {
    case 'me':
      return <Profile />;
    case 'people':
      return <People />;
    case 'member':
      return <ShowcasePage key={route.uid} uid={route.uid} />;
    case 'list':
      return <ListPage key={route.listId} uid={route.uid} listId={route.listId} />;
    case 'item':
      return <ItemPage key={route.itemId} itemId={route.itemId} />;
    case 'home':
      return <Home />;
    case 'chat':
      return <Home />;
    case 'showcase':
      if (user && member) return <ShowcasePage key={user.uid} uid={user.uid} />;
  }
  return (
    <main className="placeholder">
      <p>{t(INTRO[route.page])}</p>
      {route.page === 'showcase' ? (
        !user && (
          <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
            {t('signIn')}
          </button>
        )
      ) : (
        <span className="badge">{t('comingSoon')}</span>
      )}
    </main>
  );
}
