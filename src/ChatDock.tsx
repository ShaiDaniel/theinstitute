// InstituteIRC lives on top of every page instead of being a page: minimized to a bar in the
// corner (with an unread count), a floating window, or a sidebar docked to one side. It stays
// connected while you browse. Once someone has used the chat it loads (minimized) on every visit,
// so unread messages show and they stay online. The window (top, side and corner) and the sidebar
// (inner edge) can be resized by dragging, or with the arrow keys; mode and sizes are remembered.
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
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

/** The window's width and height and the sidebar's width, in pixels. */
interface Sizes {
  w: number;
  h: number;
  side: number;
}
const DEFAULT_SIZES: Sizes = { w: 780, h: 560, side: 440 };
const MIN_SIZES: Sizes = { w: 360, h: 300, side: 300 };
const clamp = (x: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(x, Math.max(lo, hi))));
/** Never smaller than usable, never bigger than the screen (the sidebar leaves the page 320 px). */
const fitSizes = (s: Sizes): Sizes => ({
  w: clamp(s.w, MIN_SIZES.w, innerWidth - 32),
  h: clamp(s.h, MIN_SIZES.h, innerHeight - 32),
  side: clamp(s.side, MIN_SIZES.side, innerWidth - 320),
});
function savedSizes(): Sizes {
  try {
    const x = JSON.parse(read('chat:sizes') ?? 'null');
    if (x && [x.w, x.h, x.side].every((n) => typeof n === 'number')) return fitSizes(x);
  } catch {
    // Use the defaults.
  }
  return fitSizes(DEFAULT_SIZES);
}

/** Which edges a handle moves: the side away from the screen edge, the top, or both. */
type Edges = { side?: boolean; top?: boolean };

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
  const [sizes, setSizes] = useState<Sizes>(savedSizes);
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
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-side', `${sizes.side}px`);
    write('chat:sizes', JSON.stringify(sizes));
  }, [sizes]);
  // A smaller screen (or a turned phone) shrinks what no longer fits.
  useEffect(() => {
    const refit = () => setSizes((s) => fitSizes(s));
    addEventListener('resize', refit);
    return () => removeEventListener('resize', refit);
  }, []);

  /** Grows toward the page: dragging away from the screen's edge (left, or right in Hebrew) and up. */
  const resized = (start: Sizes, dx: number, dy: number, edges: Edges): Sizes => {
    const out = document.documentElement.dir === 'rtl' ? dx : -dx;
    if (mode === 'sidebar') return fitSizes({ ...start, side: start.side + out });
    return fitSizes({ ...start, w: edges.side ? start.w + out : start.w, h: edges.top ? start.h - dy : start.h });
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>, edges: Edges) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, sizes };
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('chat-resizing');
    document.documentElement.style.cursor = getComputedStyle(handle).cursor;
    const move = (ev: globalThis.PointerEvent) => setSizes(resized(start.sizes, ev.clientX - start.x, ev.clientY - start.y, edges));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.documentElement.classList.remove('chat-resizing');
      document.documentElement.style.cursor = '';
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  /** Arrow keys on a focused handle: 20 px a press. */
  const keyResize = (e: KeyboardEvent<HTMLDivElement>, edges: Edges) => {
    const step = 20;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if ((!dx || !edges.side) && (!dy || !edges.top)) return;
    e.preventDefault();
    setSizes(resized(sizes, edges.side ? dx : 0, edges.top ? dy : 0, edges));
  };

  const handle = (cls: string, edges: Edges, label: string) => (
    <div
      className={`dock-resize ${cls}`}
      role="separator"
      aria-label={label}
      aria-orientation={edges.top && !edges.side ? 'horizontal' : 'vertical'}
      tabIndex={0}
      onPointerDown={(e) => startDrag(e, edges)}
      onKeyDown={(e) => keyResize(e, edges)}
      onDoubleClick={() => setSizes(fitSizes(DEFAULT_SIZES))}
      title={`${label} · ${t('chatResizeReset')}`}
    />
  );

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
        <div
          className={`chat-dock ${mode}`}
          hidden={mode === 'min'}
          style={{ '--chat-w': `${sizes.w}px`, '--chat-h': `${sizes.h}px` } as React.CSSProperties}
        >
          {mode === 'window' && (
            <>
              {handle('rz-side', { side: true }, t('chatResizeWidth'))}
              {handle('rz-top', { top: true }, t('chatResizeHeight'))}
              {handle('rz-corner', { side: true, top: true }, t('chatResize'))}
            </>
          )}
          {mode === 'sidebar' && handle('rz-side', { side: true }, t('chatResizeWidth'))}
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
