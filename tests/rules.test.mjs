// Checks firestore.rules against the Firestore emulator: npm run test:rules
import assert from 'node:assert/strict';
import { initializeApp, setLogLevel } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, collection, query, where,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore/lite';

setLogLevel('silent');
const projectId = 'demo-institute';
let n = 0;
function as(uid) {
  const app = initializeApp({ projectId, apiKey: 'fake' }, `app${n++}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8085, uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined);
  return db;
}
const profile = (extra = {}) => ({
  name: 'Someone', photo: null, visibility: 'members', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
const ok = (p) => p;
const denied = (p) => assert.rejects(p, (e) => e.code === 'permission-denied');

const anon = as(null), alice = as('alice'), bob = as('bob'), eve = as('eve');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await test('create own profile', () => ok(setDoc(doc(alice, 'members/alice'), profile({ name: 'Alice' }))));
await test('cannot create for someone else', () => denied(setDoc(doc(eve, 'members/alice2'), profile())));
await test('extra fields rejected', () => denied(setDoc(doc(bob, 'members/bob'), profile({ admin: true }))));
await test('bad visibility rejected', () => denied(setDoc(doc(bob, 'members/bob'), profile({ visibility: 'secret' }))));
await test('empty name rejected', () => denied(setDoc(doc(bob, 'members/bob'), profile({ name: '' }))));
await test('client-chosen createdAt rejected', () => denied(setDoc(doc(bob, 'members/bob'), profile({ createdAt: new Date(0) }))));
await test('bob creates a public profile', () => ok(setDoc(doc(bob, 'members/bob'), profile({ name: 'Bob', visibility: 'public' }))));

await test('anonymous reads public profile', async () => assert.equal((await getDoc(doc(anon, 'members/bob'))).data().name, 'Bob'));
await test('anonymous cannot read members-only profile', () => denied(getDoc(doc(anon, 'members/alice'))));
await test('signed-in non-member cannot read members-only', () => denied(getDoc(doc(eve, 'members/alice'))));
await test('member reads members-only profile', async () => assert.equal((await getDoc(doc(bob, 'members/alice'))).data().name, 'Alice'));
await test('non-member reads own missing profile', async () => assert.equal((await getDoc(doc(eve, 'members/eve'))).exists(), false));
await test('anonymous lists public profiles', async () =>
  assert.equal((await getDocs(query(collection(anon, 'members'), where('visibility', '==', 'public')))).size, 1));
await test('anonymous cannot list everything', () => denied(getDocs(collection(anon, 'members'))));
await test('member lists everything', async () => assert.equal((await getDocs(collection(alice, 'members'))).size, 2));

await test('update own profile', () => ok(updateDoc(doc(alice, 'members/alice'), { name: 'Alice C', updatedAt: serverTimestamp() })));
await test('cannot change createdAt', () => denied(updateDoc(doc(alice, 'members/alice'), { createdAt: new Date(0), updatedAt: serverTimestamp() })));
await test('cannot edit someone else', () => denied(updateDoc(doc(bob, 'members/alice'), { name: 'pwned', updatedAt: serverTimestamp() })));
await test('cannot delete someone else', () => denied(deleteDoc(doc(bob, 'members/alice'))));
await test('other collections denied', () => denied(setDoc(doc(alice, 'anything/x'), { a: 1 })));
await test('delete own profile', () => ok(deleteDoc(doc(alice, 'members/alice'))));

console.log(`\n${passed} passed`);
process.exit(0);
