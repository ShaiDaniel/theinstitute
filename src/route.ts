// Hash routes, so GitHub Pages serves every page from index.html:
// #/ home, #/showcase (your lists), #/people, #/chat, #/about, #/me, #/u/<uid> a member's lists, #/u/<uid>/l/<listId> one list,
// #/item/<itemId> an album, band or song.
import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' | 'showcase' | 'people' | 'chat' | 'about' | 'me' }
  | { page: 'member'; uid: string }
  | { page: 'list'; uid: string; listId: string }
  | { page: 'item'; itemId: string };

export type Tab = 'home' | 'showcase' | 'people' | 'chat' | 'about';

export function parseRoute(hash: string): Route {
  const [first, second, third, fourth] = hash.replace(/^#\/?/, '').split('/');
  switch (first) {
    case 'showcase':
    case 'people':
    case 'chat':
    case 'about':
    case 'me':
      return { page: first };
    case 'u':
      if (second && third === 'l' && fourth) return { page: 'list', uid: decodeURIComponent(second), listId: decodeURIComponent(fourth) };
      if (second) return { page: 'member', uid: decodeURIComponent(second) };
      break;
    case 'item':
      if (second) return { page: 'item', itemId: decodeURIComponent(second) };
  }
  return { page: 'home' };
}

export function hrefOf(route: Route | Route['page']): string {
  const r = typeof route === 'string' ? ({ page: route } as Route) : route;
  if (r.page === 'member') return `#/u/${encodeURIComponent(r.uid)}`;
  if (r.page === 'list') return `#/u/${encodeURIComponent(r.uid)}/l/${encodeURIComponent(r.listId)}`;
  if (r.page === 'item') return `#/item/${encodeURIComponent(r.itemId)}`;
  return r.page === 'home' ? '#/' : `#/${r.page}`;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
