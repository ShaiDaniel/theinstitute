// Hash routes, so GitHub Pages serves every page from index.html.
import { useEffect, useState } from 'react';

export type Page = 'showcase' | 'people' | 'chat' | 'about' | 'me';
const PAGES: Page[] = ['showcase', 'people', 'chat', 'about', 'me'];

export function parseRoute(hash: string): Page {
  const first = hash.replace(/^#\/?/, '').split('/')[0] as Page;
  return PAGES.includes(first) ? first : 'showcase';
}

export const hrefOf = (page: Page) => (page === 'showcase' ? '#/' : `#/${page}`);

export function useRoute() {
  const [page, setPage] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setPage(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return page;
}
