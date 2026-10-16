// Checks database.rules.json (the chat) against the Realtime Database emulator: npm run test:rules
import assert from 'node:assert/strict';
import { initializeApp, setLogLevel } from 'firebase/app';
import { connectDatabaseEmulator, get, getDatabase, push, ref, remove, serverTimestamp, set, update } from 'firebase/database';

setLogLevel('silent');
const [HOST, PORT] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9010').split(':');
const NS = 'demo-institute-default-rtdb';
let n = 0;
function as(uid) {
  const app = initializeApp({ projectId: 'demo-institute', apiKey: 'fake', databaseURL: `http://${HOST}:${PORT}?ns=${NS}` }, `rtdb${n++}`);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, HOST, Number(PORT), uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined);
  return db;
}
const ok = (p) => p;
const denied = (p) => assert.rejects(p, (e) => /PERMISSION_DENIED|permission/i.test(String(e?.message ?? e)));
const pause = () => new Promise((r) => setTimeout(r, 800)); // the rate limit is one post per 0.7 s

const anon = as(null), alice = as('alice'), bob = as('bob'), eve = as('eve');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const now = serverTimestamp();

/** A message plus the rate-limit stamp, written together as the app does. */
const post = (db, uid, path, nick, text, type = 'msg') => {
  const id = push(ref(db, path)).key;
  return update(ref(db), { [`${path}/${id}`]: { uid, nick, type, text, at: now }, [`rate/${uid}`]: now });
};
const takeNick = (db, uid, nick) => update(ref(db), { [`users/${uid}/nick`]: nick, [`nicks/${nick.toLowerCase()}`]: uid });

// --- Nicks ---------------------------------------------------------------------------------
await test('take a nick', () => ok(takeNick(alice, 'alice', 'Alice')));
await test('bob takes a nick', () => ok(takeNick(bob, 'bob', 'Bobby')));
await test('nick already taken', () => denied(takeNick(eve, 'eve', 'alice')));
await test('nick must look like an IRC nick', () => denied(takeNick(eve, 'eve', '9lives')));
await test('cannot set a nick without reserving it', () => denied(set(ref(eve, 'users/eve/nick'), 'Sneaky')));
await test('eve takes a nick', () => ok(takeNick(eve, 'eve', 'Eve')));
await test('visitors cannot read nicks', () => denied(get(ref(anon, 'users'))));
await test('change nick: release the old one', () =>
  ok(update(ref(bob), { 'users/bob/nick': 'Bob', 'nicks/bob': 'bob', 'nicks/bobby': null })));
await test("cannot release someone else's nick", () => denied(remove(ref(eve, 'nicks/alice'))));

// --- Presence ------------------------------------------------------------------------------
await test('presence with own nick', () => ok(set(ref(alice, 'presence/alice'), { nick: 'Alice', at: now })));
await test('presence with a wrong nick', () => denied(set(ref(eve, 'presence/eve'), { nick: 'Alice', at: now })));
await test('set away', () => ok(update(ref(alice, 'presence/alice'), { away: 'lunch' })));
await test('away message too long', () => denied(update(ref(alice, 'presence/alice'), { away: 'x'.repeat(201) })));
await test("cannot write someone else's presence", () => denied(set(ref(eve, 'presence/alice'), { nick: 'Eve', at: now })));

// --- Channels ------------------------------------------------------------------------------
const create = (db, uid, chan) =>
  update(ref(db), { [`channels/${chan}/createdBy`]: uid, [`channels/${chan}/createdAt`]: now, [`channels/${chan}/ops/${uid}`]: true });
const join = (db, uid, chan, nick) => set(ref(db, `occupants/${chan}/${uid}`), { nick, at: now });

await test('create a channel and become op', () => ok(create(alice, 'alice', 'institute')));
await test('cannot take over an existing channel', () => denied(create(bob, 'bob', 'institute')));
await test('channel names are lowercase words', () => denied(create(bob, 'bob', 'Bad Name')));
await test('join a channel', async () => {
  await ok(join(alice, 'alice', 'institute', 'Alice'));
  await ok(join(bob, 'bob', 'institute', 'Bob'));
});
await test('cannot join as someone else', () => denied(join(eve, 'bob', 'institute', 'Bob')));
await test('post a message', () => ok(post(bob, 'bob', 'messages/institute', 'Bob', 'hi all')));
await test('rate limit: too fast', () => denied(post(bob, 'bob', 'messages/institute', 'Bob', 'again')));
await pause();
await test('cannot post under another nick', () => denied(post(bob, 'bob', 'messages/institute', 'Alice', 'fake')));
await pause();
await test('cannot post as another uid', () => denied(post(bob, 'alice', 'messages/institute', 'Alice', 'fake')));
await test('visitors cannot read messages', () => denied(get(ref(anon, 'messages/institute'))));
await test('members read messages', async () => assert.equal((await get(ref(eve, 'messages/institute'))).size, 1));
await test('messages cannot be edited or deleted', async () => {
  const id = Object.keys((await get(ref(bob, 'messages/institute'))).val())[0];
  await denied(set(ref(bob, `messages/institute/${id}/text`), 'edited'));
  await denied(remove(ref(bob, `messages/institute/${id}`)));
});

await test('anyone sets the topic by default', () => ok(set(ref(bob, 'channels/institute/topic'), { text: 'nu-metal forever', nick: 'Bob', at: now })));
await test('non-op cannot set modes', () => denied(set(ref(bob, 'channels/institute/modes/t'), true)));
await test('op sets +t', () => ok(set(ref(alice, 'channels/institute/modes/t'), true)));
await test('+t: non-op cannot set the topic', () => denied(set(ref(bob, 'channels/institute/topic'), { text: 'mine', nick: 'Bob', at: now })));
await test('unknown modes rejected', () => denied(set(ref(alice, 'channels/institute/modes/x'), true)));

await test('op sets +m', () => ok(set(ref(alice, 'channels/institute/modes/m'), true)));
await pause();
await test('+m: unvoiced cannot speak', () => denied(post(bob, 'bob', 'messages/institute', 'Bob', 'muted?')));
await test('op voices bob', () => ok(set(ref(alice, 'channels/institute/voice/bob'), true)));
await test('+m: voiced can speak', () => ok(post(bob, 'bob', 'messages/institute', 'Bob', 'voiced')));
await test('non-op cannot op himself', () => denied(set(ref(bob, 'channels/institute/ops/bob'), true)));
await test('op ops another', () => ok(set(ref(alice, 'channels/institute/ops/bob'), true)));
await test('ops can unset +m', () => ok(set(ref(bob, 'channels/institute/modes/m'), false)));

await test('eve joins', () => ok(join(eve, 'eve', 'institute', 'Eve')));
await test('non-op cannot kick', () => denied(remove(ref(eve, 'occupants/institute/bob'))));
await test('op kicks and bans eve', async () => {
  await ok(remove(ref(alice, 'occupants/institute/eve')));
  await ok(set(ref(alice, 'channels/institute/bans/eve'), true));
});
await test('banned cannot rejoin', () => denied(join(eve, 'eve', 'institute', 'Eve')));
await pause();
await test('banned cannot post', () => denied(post(eve, 'eve', 'messages/institute', 'Eve', 'let me in')));
await test('banned cannot read', () => denied(get(ref(eve, 'messages/institute'))));
await test('ops cannot ban themselves', () => denied(set(ref(alice, 'channels/institute/bans/alice'), true)));
await test('op unbans', () => ok(remove(ref(alice, 'channels/institute/bans/eve'))));

// --- Private messages ----------------------------------------------------------------------
const pair = ['alice', 'bob'].sort().join('_');
await pause();
await test('PM between two', () => ok(post(alice, 'alice', `pm/${pair}`, 'Alice', 'psst')));
await test('the other side reads it', async () => assert.equal((await get(ref(bob, `pm/${pair}`))).size, 1));
await test('a third cannot read it', () => denied(get(ref(eve, `pm/${pair}`))));
await pause();
await test('a third cannot write into it', () => denied(post(eve, 'eve', `pm/${pair}`, 'Eve', 'hi')));
await test("sender adds the conversation to the other's index", () => ok(set(ref(alice, 'pmIndex/bob/alice'), { at: now })));
await test("a third cannot touch someone's index", () => denied(set(ref(eve, 'pmIndex/bob/alice'), { at: now })));
await test('only the owner reads an index', async () => {
  await ok(get(ref(bob, 'pmIndex/bob')));
  await denied(get(ref(alice, 'pmIndex/bob')));
});
await test('nothing else is writable', () => denied(set(ref(alice, 'anything/else'), 1)));

console.log(`\n${passed} passed`);
process.exit(0);
