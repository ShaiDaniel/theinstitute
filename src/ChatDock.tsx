// InstituteIRC lives on top of every page instead of being a page: minimized to a bar in the
// corner (with an unread count), a floating window, or a sidebar docked to one side. It stays
// connected while you browse. Once someone has used the chat it loads (minimized) on every visit,
// so unread messages show and they stay online; the choice of window or sidebar is remembered.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSession } from './auth';
import { useI18n } from './i18n';

// The chat (and the Realtime Database it needs) loads only when it's first wanted.
const Chat = lazy(() => import('./chat/Chat'));

export type DockMode = 'min' | 'window' | 'sidebar';
type Expanded = Exclude<DockMode, 'min'>;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
};

interface Dock {
  mode: DockMode;
  open: () => void;
  toggle: () => void;
}
const DockContext = createContext<Dock | null>(null);

export function useChatDock() {
  const ctx = useContext(DockContext);
  if (!ctx) throw new Error('useChatDock outside ChatDockProvider');
  return ctx;
}

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, member } = useSession();
  const [mode, setModeState] = useState<DockMode>(() => (read('chat:mode') as DockMode) || 'min');
  const [loaded, setLoaded] = useState(() => mode !== 'min');
  const [unread, setUnread] = useState(0);
  const lastExpanded = (): Expanded => (read('chat:expanded') === 'sidebar' ? 'sidebar' : 'window');

  const setMode = useCallback((m: DockMode) => {
    setModeState(m);
    write('chat:mode', m);
    if (m !== 'min') {
      write('chat:expanded', m);
      setLoaded(true);
    }
  }, []);
  const open = useCallback(() => setMode(lastExpanded()), [setMode]);
  const toggle = useCallback(() => setMode(mode === 'min' ? lastExpanded() : 'min'), [mode, setMode]);

  // Members who have used the chat get it loaded (minimized) on every visit.
  useEffect(() => {
    if (user && member && read(`chat:used:${user.uid}`) === '1') setLoaded(true);
  }, [user, member]);
  useEffect(() => {
    if (!user) setUnread(0);
  }, [user]);

  // The sidebar takes its width from the page instead of covering it.
  useEffect(() => {
    document.documentElement.classList.toggle('chat-docked', loaded && mode === 'sidebar');
  }, [loaded, mode]);

  const controls = (
    <>
      <button type="button" title={t('chatMinimize')} aria-label={t('chatMinimize')} onClick={() => setMode('min')}>
        _
      </button>
      <button
        type="button"
        title={t(mode === 'sidebar' ? 'chatAsWindow' : 'chatAsSidebar')}
        aria-label={t(mode === 'sidebar' ? 'chatAsWindow' : 'chatAsSidebar')}
        onClick={() => setMode(mode === 'sidebar' ? 'window' : 'sidebar')}
      >
        {mode === 'sidebar' ? '❐' : '▯'}
      </button>
    </>
  );

  return (
    <DockContext.Provider value={{ mode, open, toggle }}>
      {children}
      {loaded && (
        <div className={`chat-dock ${mode}`} hidden={mode === 'min'}>
          <Suspense fallback={<div className="irc irc-loading">{t('loading')}</div>}>
            <Chat
              visible={mode !== 'min'}
              controls={controls}
              onUnread={setUnread}
              onConnected={() => user && write(`chat:used:${user.uid}`, '1')}
            />
          </Suspense>
        </div>
      )}
      {mode === 'min' && (
        <button type="button" className={`chat-pill ${unread ? 'has-unread' : ''}`} onClick={open} title={t('chatOpen')}>
          <span>InstituteIRC</span>
          {unread > 0 && <span className="chat-pill-count">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    </DockContext.Provider>
  );
}
