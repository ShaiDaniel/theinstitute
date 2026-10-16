import { useState } from 'react';
import { useI18n, type StringKey } from './i18n';

type Tab = 'showcase' | 'people' | 'chat' | 'about';
const TABS: Tab[] = ['showcase', 'people', 'chat', 'about'];
const INTRO: Record<Tab, StringKey> = {
  showcase: 'showcaseIntro',
  people: 'peopleIntro',
  chat: 'chatIntro',
  about: 'aboutIntro',
};

export function App() {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<Tab>('showcase');

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>The Institute</h1>
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
          <button type="button" className="btn" disabled title={t('comingSoon')}>
            {t('signIn')}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((id) => (
          <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {t(id)}
          </button>
        ))}
      </nav>

      <main className="placeholder">
        <p>{t(INTRO[tab])}</p>
        <span className="badge">{t('comingSoon')}</span>
      </main>
    </div>
  );
}
