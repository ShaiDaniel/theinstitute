// Member profiles: members/{uid}, written only by that member. Deliberately minimal for now
// (name, photo). Visibility is not chosen here: each list has its own, and the profile is public
// while any of the member's lists is public (kept in step by entries.ts), members-only otherwise.
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore/lite';
import { deleteAllLists } from './entries';
import { db } from './firebase';

export type Visibility = 'public' | 'members';

export interface Member {
  uid: string;
  name: string;
  photo: string | null;
  visibility: Visibility;
}

export const NAME_MAX = 60;

const toMember = (uid: string, x: DocumentData): Member => ({
  uid,
  name: x.name ?? '',
  photo: x.photo ?? null,
  visibility: x.visibility === 'public' ? 'public' : 'members',
});

const memberRef = (uid: string) => doc(db, 'members', uid);

export async function loadMember(uid: string): Promise<Member | null> {
  const snap = await getDoc(memberRef(uid));
  return snap.exists() ? toMember(uid, snap.data()) : null;
}

/** Everyone the viewer may see: all members for members, public pages for everyone else. */
export async function listMembers(viewerIsMember: boolean): Promise<Member[]> {
  const all = collection(db, 'members');
  const snap = await getDocs(viewerIsMember ? all : query(all, where('visibility', '==', 'public')));
  return snap.docs.map((d) => toMember(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates or updates the signed-in member's profile. */
export async function saveMember(uid: string, input: { name: string; photo: string | null }, previous: Member | null) {
  const data = { name: input.name.trim().slice(0, NAME_MAX), photo: input.photo, updatedAt: serverTimestamp() };
  if (previous) await updateDoc(memberRef(uid), data);
  else await setDoc(memberRef(uid), { ...data, visibility: 'members', createdAt: serverTimestamp() });
}

/** Removes the member's profile and all their lists. */
export async function deleteMember(uid: string) {
  await deleteAllLists(uid);
  await deleteDoc(memberRef(uid));
}
