// Checks firestore.rules against the Firestore emulator: npm run test:rules
import assert from 'node:assert/strict';
import { initializeApp, setLogLevel } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, collection, collectionGroup, query, where,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore/lite';

setLogLevel('silent');
const projectId = 'demo-institute';
// Set by `firebase emulators:exec` (firebase.test.json: its own port, so tests run beside `npm run emulators`).
const PORT = Number((process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8095').split(':').pop());
let n = 0;
function as(uid) {
  const app = initializeApp({ projectId, apiKey: 'fake' }, `app${n++}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', PORT, uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined);
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

// --- Lists and entries -------------------------------------------------------------------
const A = 'album:f50fbcb4-bfcd-3784-b4c9-44f4793e66b2';
const list = (uid, extra = {}) => ({
  uid, kind: 'album', name: 'All-time', visibility: 'private', position: 1,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
const entry = (uid, listId, extra = {}) => ({
  uid, listId, kind: 'album', itemId: A, title: 'Toxicity', artist: 'System of a Down', year: 2001, image: null, ref: '',
  position: 1, score: 9.5, tags: ['classic'], note: '', visibility: 'private',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
const L = (uid, id) => `members/${uid}/lists/${id}`;
const E = (uid, id, item = A) => `members/${uid}/lists/${id}/entries/${item}`;
const touch = (x) => ({ ...x, updatedAt: serverTimestamp() });
const whoQuery = (db, vis) =>
  query(collectionGroup(db, 'entries'), where('itemId', '==', A), ...(vis ? [where('visibility', Array.isArray(vis) ? 'in' : '==', vis)] : []));

await test('create own list', () => ok(setDoc(doc(alice, L('alice', 'top')), list('alice'))));
await test('non-member cannot create a list', () => denied(setDoc(doc(eve, L('eve', 'x')), list('eve'))));
await test('cannot create a list for someone else', () => denied(setDoc(doc(bob, L('alice', 'x')), list('alice'))));
await test('bad list kind rejected', () => denied(setDoc(doc(alice, L('alice', 'x')), list('alice', { kind: 'movie' }))));
await test('empty list name rejected', () => denied(setDoc(doc(alice, L('alice', 'x')), list('alice', { name: '' }))));
await test('add entry to own private list', () => ok(setDoc(doc(alice, E('alice', 'top')), entry('alice', 'top'))));
await test('entry cannot be looser than its list', () =>
  denied(setDoc(doc(alice, E('alice', 'top', 'album:b')), entry('alice', 'top', { itemId: 'album:b', visibility: 'public' }))));
await test('entry kind must match the list', () =>
  denied(setDoc(doc(alice, E('alice', 'top', 'band:x')), entry('alice', 'top', { kind: 'band', itemId: 'band:x' }))));
await test('entry needs an existing list', () => denied(setDoc(doc(alice, E('alice', 'nope')), entry('alice', 'nope'))));
await test('listId must match', () => denied(setDoc(doc(alice, E('alice', 'top', 'album:c')), entry('alice', 'other', { itemId: 'album:c' }))));
await test('score must be in half points', () =>
  denied(setDoc(doc(alice, E('alice', 'top', 'album:c')), entry('alice', 'top', { itemId: 'album:c', score: 7.3 }))));
await test('unknown tag rejected', () => denied(setDoc(doc(alice, E('alice', 'top', 'album:c')), entry('alice', 'top', { itemId: 'album:c', tags: ['meh'] }))));
await test("cannot add to someone else's list", () => denied(setDoc(doc(bob, E('alice', 'top', 'album:c')), entry('alice', 'top', { itemId: 'album:c' }))));

await test('private list hidden from members', () => denied(getDoc(doc(bob, L('alice', 'top')))));
await test('private entry hidden from members', () => denied(getDoc(doc(bob, E('alice', 'top')))));
await test('owner reads own private list', async () => assert.equal((await getDoc(doc(alice, L('alice', 'top')))).data().name, 'All-time'));

// The same album in a second, members-only list of alice's, with its own score.
await test('second list, members-only, same album', async () => {
  await ok(setDoc(doc(alice, L('alice', 'nu')), list('alice', { name: 'Nu-metal', visibility: 'members' })));
  await ok(setDoc(doc(alice, E('alice', 'nu')), entry('alice', 'nu', { score: 10, visibility: 'members' })));
});
await test('member reads members-only list', async () => assert.equal((await getDoc(doc(bob, L('alice', 'nu')))).data().name, 'Nu-metal'));
await test('visitor cannot read members-only list', () => denied(getDoc(doc(anon, L('alice', 'nu')))));
await test("member lists alice's shared lists", async () =>
  assert.equal((await getDocs(query(collection(bob, 'members/alice/lists'), where('visibility', 'in', ['public', 'members'])))).size, 1));
await test("member cannot list all of alice's lists", () => denied(getDocs(collection(bob, 'members/alice/lists'))));

await test("member reads a shared list's entries (filtered, as the app does)", async () =>
  assert.equal((await getDocs(query(collection(bob, `${L('alice', 'nu')}/entries`), where('visibility', 'in', ['public', 'members'])))).size, 1));
await test("unfiltered read of someone else's list entries denied", () => denied(getDocs(collection(bob, `${L('alice', 'nu')}/entries`))));
await test('who-ranked-it (member): shared only', async () => assert.equal((await getDocs(whoQuery(bob, ['public', 'members']))).size, 1));
await test('who-ranked-it (visitor): public only', async () => assert.equal((await getDocs(whoQuery(anon, 'public'))).size, 0));
await test('who-ranked-it unfiltered denied', () => denied(getDocs(whoQuery(bob))));

await test('widening: entry cannot go public before its list', () => denied(updateDoc(doc(alice, E('alice', 'nu')), touch({ visibility: 'public' }))));
await test('widening: list first, then entries', async () => {
  await ok(updateDoc(doc(alice, L('alice', 'nu')), touch({ visibility: 'public' })));
  await ok(updateDoc(doc(alice, E('alice', 'nu')), touch({ visibility: 'public' })));
  assert.equal((await getDocs(whoQuery(anon, 'public'))).size, 1);
  assert.equal((await getDoc(doc(anon, E('alice', 'nu')))).data().score, 10);
});
await test('narrowing: entries first, then list', async () => {
  await ok(updateDoc(doc(alice, E('alice', 'nu')), touch({ visibility: 'private' })));
  await ok(updateDoc(doc(alice, L('alice', 'nu')), touch({ visibility: 'private' })));
  await denied(getDoc(doc(anon, E('alice', 'nu'))));
  await denied(getDoc(doc(bob, E('alice', 'nu'))));
});
await test('update score, tags, note, position', () =>
  ok(updateDoc(doc(alice, E('alice', 'top')), touch({ score: 10, tags: ['classic', 'lifeChanging'], note: 'yes', position: 0.5 }))));
await test("cannot change an entry's title", () => denied(updateDoc(doc(alice, E('alice', 'top')), touch({ title: 'Other' }))));
await test("cannot change a list's kind", () => denied(updateDoc(doc(alice, L('alice', 'top')), touch({ kind: 'band' }))));
await test('rename list', () => ok(updateDoc(doc(alice, L('alice', 'top')), touch({ name: 'Best ever' }))));
await test("cannot delete someone else's entry or list", async () => {
  await denied(deleteDoc(doc(bob, E('alice', 'top'))));
  await denied(deleteDoc(doc(bob, L('alice', 'top'))));
});
await test('delete own entry and list', async () => {
  await ok(deleteDoc(doc(alice, E('alice', 'top'))));
  await ok(deleteDoc(doc(alice, L('alice', 'top'))));
});

// --- Concerts -------------------------------------------------------------------------------
const C = 'dz458_2005-06-14';
const concert = (uid, extra = {}) => ({
  bandDz: 458, band: 'System of a Down', image: null, date: '2005-06-14', venue: 'Park Hayarkon', city: 'Tel Aviv', country: 'Israel',
  setlist: [], setlistUrl: null, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});
await test('member creates a concert', () => ok(setDoc(doc(bob, `concerts/${C}`), concert('bob'))));
await test('non-member cannot create a concert', () => denied(setDoc(doc(eve, 'concerts/dz1_2001-01-01'), concert('eve', { bandDz: 1, date: '2001-01-01' }))));
await test('concert id must be band + date', () => denied(setDoc(doc(bob, 'concerts/dz458_1999-01-01'), concert('bob'))));
await test('concert needs a venue', () => denied(setDoc(doc(bob, 'concerts/dz2_2002-02-02'), concert('bob', { bandDz: 2, date: '2002-02-02', venue: '' }))));
await test('cannot claim someone else created it', () => denied(setDoc(doc(bob, 'concerts/dz3_2003-03-03'), concert('alice', { bandDz: 3, date: '2003-03-03' }))));
await test('anyone reads a concert', async () => assert.equal((await getDoc(doc(anon, `concerts/${C}`))).data().venue, 'Park Hayarkon'));
await test('another member edits the setlist', () =>
  ok(updateDoc(doc(alice, `concerts/${C}`), { setlist: ['Prison Song', 'Toxicity'], updatedBy: 'alice', updatedAt: serverTimestamp() })));
await test('setlist.fm link accepted', () =>
  ok(updateDoc(doc(alice, `concerts/${C}`), { setlistUrl: 'https://www.setlist.fm/setlist/system-of-a-down/2005/x.html', updatedBy: 'alice', updatedAt: serverTimestamp() })));
await test('other links rejected', () =>
  denied(updateDoc(doc(alice, `concerts/${C}`), { setlistUrl: 'https://evil.example/x', updatedBy: 'alice', updatedAt: serverTimestamp() })));
await test('band and date never change', () =>
  denied(updateDoc(doc(alice, `concerts/${C}`), { band: 'Other', updatedBy: 'alice', updatedAt: serverTimestamp() })));
await test('updatedBy must be the editor', () =>
  denied(updateDoc(doc(alice, `concerts/${C}`), { venue: 'X', updatedBy: 'bob', updatedAt: serverTimestamp() })));
await test('visitor cannot edit a concert', () => denied(updateDoc(doc(anon, `concerts/${C}`), { venue: 'X', updatedAt: serverTimestamp() })));
await test('nobody deletes a concert', () => denied(deleteDoc(doc(bob, `concerts/${C}`))));
await test('concert list and entry', async () => {
  await ok(setDoc(doc(alice, L('alice', 'gigs')), list('alice', { kind: 'concert', name: 'Best gigs' })));
  await ok(setDoc(doc(alice, E('alice', 'gigs', `concert:${C}`)),
    entry('alice', 'gigs', { kind: 'concert', itemId: `concert:${C}`, title: 'System of a Down', artist: 'Park Hayarkon, Tel Aviv', year: 2005, tags: ['legendaryNight'] })));
});

await test('anyone reads stats/public', () => ok(getDoc(doc(anon, 'stats/public'))));
await test('visitor cannot read stats/members', () => denied(getDoc(doc(anon, 'stats/members'))));
await test('member reads stats/members', () => ok(getDoc(doc(bob, 'stats/members'))));
await test('nobody reads stats/source', () => denied(getDoc(doc(bob, 'stats/source'))));
await test('clients cannot write stats', () => denied(setDoc(doc(bob, 'stats/public'), { totals: {} })));
await test('delete own profile', () => ok(deleteDoc(doc(alice, 'members/alice'))));

console.log(`\n${passed} passed`);
process.exit(0);
