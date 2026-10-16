// A right-click (or long-press) menu, like mIRC's popups. Closes on a click elsewhere, Escape,
// scrolling or resizing; arrow keys move between items.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; run: () => void; danger?: boolean } | 'separator';

export interface MenuState {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(menu.x, innerWidth - width - 4)), top: Math.max(4, Math.min(menu.y, innerHeight - height - 4)) });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menu]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [...(box.current?.querySelectorAll('button') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    };
    addEventListener('mousedown', outside);
    addEventListener('touchstart', outside);
    addEventListener('keydown', key);
    addEventListener('resize', onClose);
    addEventListener('scroll', onClose, true);
    return () => {
      removeEventListener('mousedown', outside);
      removeEventListener('touchstart', outside);
      removeEventListener('keydown', key);
      removeEventListener('resize', onClose);
      removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <div className="irc-menu" ref={box} role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {menu.title && <div className="irc-menu-title">{menu.title}</div>}
      {menu.items.map((item, i) =>
        item === 'separator' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
