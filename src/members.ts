// Member profiles: members/{uid}, written only by that member. Deliberately minimal for now
// (name, photo, who can see the page); the rest of the profile is defined with the features.
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, type DocumentData } from 'firebase/firestore/lite';
import { db } from './firebase';

export type Visibility = 'public' | 'members';

export interface Member {
  uid: string;
  name: string;
  photo: string | null;
  visibility: Visibility;
}

export type MemberInput = Omit<Member, 'uid'>;

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

/** Creates or updates the signed-in member's profile. */
export async function saveMember(uid: string, input: MemberInput, exists: boolean) {
  const data = {
    name: input.name.trim().slice(0, NAME_MAX),
    photo: input.photo,
    visibility: input.visibility,
    updatedAt: serverTimestamp(),
  };
  if (exists) await updateDoc(memberRef(uid), data);
  else await setDoc(memberRef(uid), { ...data, createdAt: serverTimestamp() });
}

export const deleteMember = (uid: string) => deleteDoc(memberRef(uid));
