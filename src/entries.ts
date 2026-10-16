// Showcase lists and their entries:
//   members/{uid}/lists/{listId}                  a named, ranked list of one kind (albums, bands or songs)
//   members/{uid}/lists/{listId}/entries/{itemId} one item in it, with its own score, tags and note
// Each list is private (only its owner), members-only or public. Entries carry a copy of their list's
// visibility, so "who ranked it" can be queried across members without exposing anything that isn't
// shared; firestore.rules checks the copy. The member's profile is public while any list is public.
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Query,
} from 'firebase/firestore/lite';
import { db } from './firebase';
import type { Item, Kind } from './music';

export const TAGS = [
  'lifeChanging',
  'classic',
  'desertIsland',
  'guiltyPleasure',
  'grewOnMe',
  'underrated',
  'overrated',
  'agedBadly',
  'legendaryNight',
] as const;
export type Tag = (typeof TAGS)[number];
/** Tags that only make sense for some kinds; the rest apply to everything. */
const CONCERT_ONLY: Tag[] = ['legendaryNight'];
export const tagsFor = (kind: Kind | 'concert') => TAGS.filter((t) => kind === 'concert' || !CONCERT_ONLY.includes(t));

export const NOTE_MAX = 1000;
export const LIST_NAME_MAX = 80;
export const SCORES = Array.from({ length: 19 }, (_, i) => 1 + i / 2); // 1, 1.5, … 10

export type ListVisibility = 'private' | 'members' | 'public';
export const LIST_VISIBILITIES: ListVisibility[] = ['private', 'members', 'public'];

export interface List {
  uid: string;
  id: string;
  kind: Kind;
  name: string;
  visibility: ListVisibility;
  position: number;
}

export interface Verdict {
  score: number;
  tags: Tag[];
  note: string;
}

export interface Entry extends Item, Verdict {
  uid: string;
  listId: string;
  /** Sort key within the list; lower is better. */
  position: number;
}

const toList = (uid: string, id: string, x: DocumentData): List => ({
  uid,
  id,
  kind: x.kind,
  name: x.name,
  visibility: x.visibility,
  position: x.position ?? 0,
});

const toEntry = (x: DocumentData): Entry => ({
  uid: x.uid,
  listId: x.listId,
  kind: x.kind,
  itemId: x.itemId,
  title: x.title,
  artist: x.artist ?? '',
  year: x.year ?? null,
  image: x.image ?? null,
  ref: x.ref ?? '',
  position: x.position,
  score: x.score,
  tags: x.tags ?? [],
  note: x.note ?? '',
});

const lists = (uid: string) => collection(db, 'members', uid, 'lists');
const listRef = (uid: string, listId: string) => doc(db, 'members', uid, 'lists', listId);
const entries = (uid: string, listId: string) => collection(db, 'members', uid, 'lists', listId, 'entries');
const entryRef = (uid: string, listId: string, itemId: string) => doc(db, 'members', uid, 'lists', listId, 'entries', itemId);

/** Who may see what: the owner sees everything, members see shared, visitors see public. */
export type Viewer = 'owner' | 'member' | 'visitor';
const visible = <T,>(q: Query<T>, viewer: Viewer) =>
  viewer === 'owner' ? q : viewer === 'member' ? query(q, where('visibility', 'in', ['public', 'members'])) : query(q, where('visibility', '==', 'public'));

// --- Lists --------------------------------------------------------------------------------

export async function loadLists(uid: string, viewer: Viewer): Promise<List[]> {
  const snap = await getDocs(visible(lists(uid), viewer));
  return snap.docs.map((d) => toList(uid, d.id, d.data())).sort((a, b) => a.position - b.position);
}

export async function loadList(uid: string, listId: string): Promise<List | null> {
  const snap = await getDoc(listRef(uid, listId));
  return snap.exists() ? toList(uid, snap.id, snap.data()) : null;
}

export async function createList(uid: string, kind: Kind, name: string, position: number): Promise<string> {
  const ref = await addDoc(lists(uid), {
    uid,
    kind,
    name: name.trim().slice(0, LIST_NAME_MAX),
    visibility: 'private',
    position,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export const renameList = (uid: string, listId: string, name: string) =>
  updateDoc(listRef(uid, listId), { name: name.trim().slice(0, LIST_NAME_MAX), updatedAt: serverTimestamp() });

const LEVEL: Record<ListVisibility, number> = { private: 0, members: 1, public: 2 };

/** Writes many entry changes in batches of up to 400 (Firestore allows 500 writes per batch). */
async function inBatches(ids: string[], write: (b: ReturnType<typeof writeBatch>, id: string) => void) {
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => write(b, id));
    await b.commit();
  }
}

/** Keeps the profile public exactly while one of the member's lists is public. */
async function syncProfile(uid: string) {
  const anyPublic = !(await getDocs(query(lists(uid), where('visibility', '==', 'public')))).empty;
  await updateDoc(doc(db, 'members', uid), { visibility: anyPublic ? 'public' : 'members', updatedAt: serverTimestamp() });
}

/**
 * Changes who sees a list. The entries' copies are changed in the order that never exposes them:
 * entries first when narrowing, the list first when widening (the rules allow an entry to be more
 * restricted than its list). Entries that already match are skipped, so repeating this repairs an
 * interrupted change.
 */
export async function setListVisibility(uid: string, listId: string, visibility: ListVisibility) {
  const list = await loadList(uid, listId);
  if (!list) return;
  const syncEntries = async () => {
    const ids = (await getDocs(entries(uid, listId))).docs.filter((d) => d.data().visibility !== visibility).map((d) => d.id);
    await inBatches(ids, (b, id) => b.update(entryRef(uid, listId, id), { visibility, updatedAt: serverTimestamp() }));
  };
  if (LEVEL[visibility] < LEVEL[list.visibility]) await syncEntries();
  await updateDoc(listRef(uid, listId), { visibility, updatedAt: serverTimestamp() });
  await syncEntries();
  await syncProfile(uid);
}

export async function deleteList(uid: string, listId: string) {
  const ids = (await getDocs(entries(uid, listId))).docs.map((d) => d.id);
  await inBatches(ids, (b, id) => b.delete(entryRef(uid, listId, id)));
  await deleteDoc(listRef(uid, listId));
  await syncProfile(uid);
}

/** Removes every list and entry of a member (before deleting their profile). */
export async function deleteAllLists(uid: string) {
  for (const d of (await getDocs(lists(uid))).docs) {
    const ids = (await getDocs(entries(uid, d.id))).docs.map((e) => e.id);
    await inBatches(ids, (b, id) => b.delete(entryRef(uid, d.id, id)));
    await deleteDoc(d.ref);
  }
}

// --- Entries ------------------------------------------------------------------------------

/** A list's entries that the viewer may see, best first. */
export async function loadEntries(uid: string, listId: string, viewer: Viewer): Promise<Entry[]> {
  const snap = await getDocs(visible(entries(uid, listId), viewer));
  return snap.docs.map((d) => toEntry(d.data())).sort((a, b) => a.position - b.position);
}

/** Every shared entry for one item, across members and lists (the viewer's own included if shared). */
export async function whoRanked(itemId: string, viewer: 'member' | 'visitor'): Promise<Entry[]> {
  const snap = await getDocs(visible(query(collectionGroup(db, 'entries'), where('itemId', '==', itemId)), viewer));
  return snap.docs.map((d) => toEntry(d.data()));
}

/** The stored form of an entry (also used by import, so both write exactly the same thing). */
export const entryData = (list: List, item: Item, position: number, verdict: Verdict) => ({
  uid: list.uid,
  listId: list.id,
  kind: item.kind,
  itemId: item.itemId,
  title: item.title.slice(0, 300),
  artist: item.artist.slice(0, 300),
  year: item.year,
  image: item.image,
  ref: item.ref,
  position,
  score: verdict.score,
  tags: verdict.tags,
  note: verdict.note.trim().slice(0, NOTE_MAX),
  visibility: list.visibility,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

export const entryDoc = (list: List, itemId: string) => entryRef(list.uid, list.id, itemId);

export async function addEntry(list: List, item: Item, position: number, verdict: Verdict) {
  await setDoc(entryRef(list.uid, list.id, item.itemId), entryData(list, item, position, verdict));
}

export const updateVerdict = (e: Entry, v: Verdict) =>
  updateDoc(entryRef(e.uid, e.listId, e.itemId), { score: v.score, tags: v.tags, note: v.note.trim().slice(0, NOTE_MAX), updatedAt: serverTimestamp() });

export const movePosition = (e: Entry, position: number) => updateDoc(entryRef(e.uid, e.listId, e.itemId), { position, updatedAt: serverTimestamp() });

export const removeEntry = (e: Entry) => deleteDoc(entryRef(e.uid, e.listId, e.itemId));
