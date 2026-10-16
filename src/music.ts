// Music data, all called straight from the browser (tested 2026-10-16, see PLAN.md).
// Search uses Deezer for everything: it is fast and never turns requests away. (MusicBrainz is just
// as fast but refuses about one request in five, and asks for at most one per second.)
// What makes two members' entries "the same item":
// - Albums: the MusicBrainz release group, looked up once when the album is added, so every
//   edition (deluxe, remaster) is one album. If MusicBrainz has no match, the Deezer album.
// - Bands: the Deezer artist.
// - Concerts: the band's Deezer artist plus the date (see concerts.ts); search finds the band.
// - Songs: the Deezer artist plus the base title, so the album version, single and live take are one.
// Pictures and song previews come from Deezer; summaries from Wikipedia via Wikidata.

export type Kind = 'album' | 'band' | 'song' | 'concert';
export const KINDS: Kind[] = ['album', 'band', 'song', 'concert'];

/** A search result. */
export interface Found {
  kind: Kind;
  /** Deezer id of the album, artist or track. */
  dz: number;
  title: string;
  /** The band, for albums and songs. */
  artist: string;
  thumb: string | null;
  image: string | null;
  /** Provisional item id, used to mark results already in the list; final once resolved. */
  key: string;
}

/** What gets stored: a search result tied to its shared item id. */
export interface Item {
  kind: Kind;
  itemId: string;
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  /** Deezer track id for songs (for the preview); empty otherwise. */
  ref: string;
}

// --- Deezer, through JSONP (its API sends no CORS headers) -----------------------------

let jsonpId = 0;
function deezer<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const name = `__dz${++jsonpId}`;
    const script = document.createElement('script');
    const done = () => {
      delete (window as unknown as Record<string, unknown>)[name];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('Deezer timed out'));
    }, 10000);
    (window as unknown as Record<string, unknown>)[name] = (data: T & { error?: unknown }) => {
      done();
      if (data && data.error) reject(new Error('Deezer error'));
      else resolve(data);
    };
    script.src = `https://api.deezer.com/${path}${path.includes('?') ? '&' : '?'}output=jsonp&callback=${name}`;
    script.onerror = () => {
      done();
      reject(new Error('Deezer failed'));
    };
    document.head.appendChild(script);
  });
}

interface DzAlbum {
  id: number;
  title: string;
  record_type: string;
  cover_small: string;
  cover_medium: string;
  release_date?: string;
  artist: { id: number; name: string };
}
interface DzArtist {
  id: number;
  name: string;
  picture_small: string;
  picture_medium: string;
}
interface DzTrack {
  id: number;
  title_short: string;
  preview: string;
  link: string;
  artist: { id: number; name: string };
  album: { cover_small: string; cover_medium: string };
}

// --- MusicBrainz: one request per second, retried when busy ----------------------------

let mbLast = 0;
async function mb<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}&fmt=json`);
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 503 || attempt >= 3) throw new Error(`MusicBrainz ${res.status}`);
  }
}

// --- Helpers ----------------------------------------------------------------------------

/** "Chop Suey!" → "chop-suey"; keeps Hebrew and other letters. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';

/** "Toxicity (Deluxe Edition) [Remastered]" → "Toxicity". */
const baseTitle = (s: string) => s.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*(remaster|edition|version|live).*$/i, '').trim() || s;

const yearOf = (date?: string) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
const quoted = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

// --- Search -------------------------------------------------------------------------------

export async function search(kind: Kind, q: string): Promise<Found[]> {
  q = q.trim();
  if (!q) return [];
  const seen = new Set<string>();
  const unique = (f: Found) => !seen.has(f.key) && Boolean(seen.add(f.key));

  if (kind === 'album') {
    const r = await deezer<{ data: DzAlbum[] }>(`search/album?limit=30&q=${encodeURIComponent(q)}`);
    return r.data
      .filter((a) => a.record_type === 'album' || a.record_type === 'ep')
      .map((a) => ({
        kind,
        dz: a.id,
        title: baseTitle(a.title),
        artist: a.artist.name,
        thumb: a.cover_small,
        image: a.cover_medium,
        key: `album:dz${a.artist.id}:${slug(baseTitle(a.title))}`,
      }))
      .filter(unique)
      .slice(0, 15);
  }
  if (kind === 'band' || kind === 'concert') {
    const r = await deezer<{ data: DzArtist[] }>(`search/artist?limit=15&q=${encodeURIComponent(q)}`);
    return r.data.map((a) => ({ kind, dz: a.id, title: a.name, artist: '', thumb: a.picture_small, image: a.picture_medium, key: `${kind}:dz${a.id}` }));
  }
  const r = await deezer<{ data: DzTrack[] }>(`search/track?limit=25&q=${encodeURIComponent(q)}`);
  return r.data
    .map((t) => ({
      kind,
      dz: t.id,
      title: t.title_short,
      artist: t.artist.name,
      thumb: t.album.cover_small,
      image: t.album.cover_medium,
      key: `song:dz${t.artist.id}:${slug(t.title_short)}`,
    }))
    .filter(unique)
    .slice(0, 15);
}

/** Ties a search result to its shared item id (albums: the MusicBrainz release group). */
export async function resolve(f: Found): Promise<Item> {
  const base = { kind: f.kind, title: f.title, artist: f.artist, image: f.image, year: null as number | null, ref: '' };
  if (f.kind === 'song') return { ...base, itemId: f.key, ref: String(f.dz) };
  if (f.kind === 'band') return { ...base, itemId: f.key };
  if (f.kind === 'concert') throw new Error('Concerts are tied to a date: see concerts.ts');

  // Albums: find the release group with the same title by the same band.
  try {
    const query = `releasegroup:${quoted(f.title)} AND artist:${quoted(f.artist)} AND primarytype:(album OR ep)`;
    const r = await mb<{ 'release-groups': { id: string; score: number; title: string; 'first-release-date'?: string; 'artist-credit'?: { name: string }[] }[] }>(
      `release-group?limit=5&query=${encodeURIComponent(query)}`,
    );
    const same = (a: string, b: string) => slug(a) === slug(b);
    const hit = r['release-groups'].find((g) => same(g.title, f.title) && (g['artist-credit'] ?? []).some((c) => same(c.name, f.artist)));
    if (hit) return { ...base, itemId: `album:${hit.id}`, title: hit.title, year: yearOf(hit['first-release-date']) };
  } catch {
    // MusicBrainz unavailable: fall back to the Deezer album below.
  }
  const album = await deezer<DzAlbum>(`album/${f.dz}`).catch(() => null);
  return { ...base, itemId: `album:dz${f.dz}`, year: yearOf(album?.release_date) };
}

// --- Item details, for item pages -------------------------------------------------------

export interface Details {
  summary: string | null;
  wikiUrl: string | null;
  /** A 30-second preview, for songs. */
  preview: string | null;
  links: { label: string; url: string }[];
}

/** The Wikidata item that has this value for a property (e.g. P2722, Deezer artist id). */
async function wikidataBy(property: string, value: string): Promise<string | null> {
  const sparql = `SELECT ?item WHERE { ?item wdt:${property} "${value.replace(/"/g, '')}" } LIMIT 1`;
  const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`).then((x) => x.json());
  return (r.results?.bindings?.[0]?.item?.value as string | undefined)?.split('/').pop() ?? null;
}

async function wikipedia(wikidataId: string, lang: 'en' | 'he') {
  const wd = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks&format=json&origin=*`).then((r) =>
    r.json(),
  );
  const links = wd.entities?.[wikidataId]?.sitelinks ?? {};
  const site = links[`${lang}wiki`] ? lang : links.enwiki ? 'en' : null;
  if (!site) return null;
  const title = links[`${site}wiki`].title as string;
  const s = await fetch(`https://${site}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`).then((r) => r.json());
  return { summary: (s.extract as string) || null, url: (s.content_urls?.desktop?.page as string) ?? null };
}

export async function details(itemId: string, ref: string, lang: 'en' | 'he'): Promise<Details> {
  const [kind, id] = [itemId.slice(0, itemId.indexOf(':')), itemId.slice(itemId.indexOf(':') + 1)];
  const links: Details['links'] = [];
  let wikidata: string | null = null;
  let preview: string | null = null;

  if (kind === 'song') {
    const t = await deezer<DzTrack>(`track/${ref}`).catch(() => null);
    preview = t?.preview || null;
    if (t) links.push({ label: 'Deezer', url: t.link });
  } else if (kind === 'band' || kind === 'concert') {
    // A concert's summary is its band's.
    const dz = id.replace(/^dz/, '').replace(/_.*$/, '');
    links.push({ label: 'Deezer', url: `https://www.deezer.com/artist/${dz}` });
    wikidata = await wikidataBy('P2722', dz).catch(() => null);
  } else if (id.startsWith('dz')) {
    links.push({ label: 'Deezer', url: `https://www.deezer.com/album/${id.slice(2)}` });
    wikidata = await wikidataBy('P2723', id.slice(2)).catch(() => null);
  } else {
    links.push({ label: 'MusicBrainz', url: `https://musicbrainz.org/release-group/${id}` });
    const r = await mb<{ relations?: { type: string; url?: { resource: string } }[] }>(`release-group/${id}?inc=url-rels`).catch(() => null);
    wikidata = r?.relations?.find((x) => x.type === 'wikidata')?.url?.resource.split('/').pop() ?? null;
  }

  const wiki = wikidata ? await wikipedia(wikidata, lang).catch(() => null) : null;
  return { summary: wiki?.summary ?? null, wikiUrl: wiki?.url ?? null, preview, links };
}
