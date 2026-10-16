// Concerts: concerts/{bandDz}_{date}, one per band per day, shared by every member who was there.
// The id comes from the band (its Deezer id) and the date, so two members adding the same show
// land on the same concert without searching for each other's. The facts (venue, city, setlist)
// are kept together by members, wiki-style; each attendee's rank, score, tags and note live in
// their own concert lists, like any other entry (entries.ts).
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type DocumentData } from 'firebase/firestore/lite';
import { db } from './firebase';

export const SETLIST_MAX = 80;
export const SONG_MAX = 150;
export const PLACE_MAX = 120;

export interface Concert {
  id: string;
  bandDz: number;
  band: string;
  image: string | null;
  /** YYYY-MM-DD */
  date: string;
  venue: string;
  city: string;
  country: string;
  setlist: string[];
  /** A link to the show's page on setlist.fm, if someone added it. */
  setlistUrl: string | null;
}

export type ConcertPlace = Pick<Concert, 'venue' | 'city' | 'country'>;

export const concertId = (bandDz: number, date: string) => `dz${bandDz}_${date}`;
export const concertItemId = (id: string) => `concert:${id}`;
/** "concert:dz458_2005-06-14" → "dz458_2005-06-14" */
export const concertIdOf = (itemId: string) => itemId.slice('concert:'.length);
/** The date in a concert's item id, or null for other items. */
export const concertDateOf = (itemId: string) => /_(\d{4}-\d{2}-\d{2})$/.exec(itemId)?.[1] ?? null;

const toConcert = (id: string, x: DocumentData): Concert => ({
  id,
  bandDz: x.bandDz,
  band: x.band,
  image: x.image ?? null,
  date: x.date,
  venue: x.venue ?? '',
  city: x.city ?? '',
  country: x.country ?? '',
  setlist: x.setlist ?? [],
  setlistUrl: x.setlistUrl ?? null,
});

const ref = (id: string) => doc(db, 'concerts', id);

export async function loadConcert(id: string): Promise<Concert | null> {
  const snap = await getDoc(ref(id));
  return snap.exists() ? toConcert(id, snap.data()) : null;
}

const cleanPlace = (p: ConcertPlace) => ({
  venue: p.venue.trim().slice(0, PLACE_MAX),
  city: p.city.trim().slice(0, PLACE_MAX),
  country: p.country.trim().slice(0, PLACE_MAX),
});

/** Creates a concert (the first member to add it). */
export async function createConcert(uid: string, band: { dz: number; name: string; image: string | null }, date: string, place: ConcertPlace) {
  const id = concertId(band.dz, date);
  await setDoc(ref(id), {
    bandDz: band.dz,
    band: band.name.slice(0, 300),
    image: band.image,
    date,
    ...cleanPlace(place),
    setlist: [],
    setlistUrl: null,
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/** Updates the shared facts: where it was and what was played. */
export async function updateConcert(uid: string, id: string, change: { place?: ConcertPlace; setlist?: string[]; setlistUrl?: string | null }) {
  const data: Record<string, unknown> = { updatedBy: uid, updatedAt: serverTimestamp() };
  if (change.place) Object.assign(data, cleanPlace(change.place));
  if (change.setlist) data.setlist = change.setlist.map((s) => s.trim().slice(0, SONG_MAX)).filter(Boolean).slice(0, SETLIST_MAX);
  if (change.setlistUrl !== undefined) data.setlistUrl = change.setlistUrl;
  await updateDoc(ref(id), data);
}

/** Only setlist.fm links are kept, so the page never links anywhere unexpected. */
export const validSetlistUrl = (url: string) => /^https:\/\/(www\.)?setlist\.fm\/setlist\/[^\s]{1,300}$/.test(url.trim());

export function formatDate(date: string, lang: 'en' | 'he') {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
