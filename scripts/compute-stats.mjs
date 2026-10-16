// Computes the home page metrics and writes them to Firestore. Run hourly by
// .github/workflows/stats.yml; also runnable by hand:
//   node scripts/compute-stats.mjs [--force]
// Credentials: FIREBASE_SERVICE_ACCOUNT (the service account key's JSON), or FIRESTORE_EMULATOR_HOST
// to run against the local emulator (project demo-institute).
//
// Writes two documents (clients can read but never write them, see firestore.rules):
//   stats/public   for visitors: totals of everything, item metrics from public lists
//   stats/members  for members:  totals of everything, item metrics from public and members-only lists
// Both also carry "recent": the newest entries from those same lists, with who added them, for the
// home page feed.
// Totals count private lists too, as numbers only; nothing from a private list is ever named.
// stats/source (no client access) remembers what was counted, so unchanged data isn't re-read.
// It also announces new additions to public lists in the chat's #institute, as the bot
// "TheInstitute" (Realtime Database, admin access; see announce() below).
import { cert, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const KINDS = ['album', 'band', 'song', 'concert'];
const TOP = 10;
/** An item needs scores from at least this many members to be in "top-scored". */
const MIN_MEMBERS = 3;

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!emulator && !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('No FIREBASE_SERVICE_ACCOUNT set; nothing to do.');
  process.exit(0);
}
// The chat database (public address; see src/firebase-config.ts). The emulator's is named after the project.
const DATABASE_URL = emulator
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000'}?ns=demo-institute-default-rtdb`
  : 'https://theinstitute-8575b-default-rtdb.europe-west1.firebasedatabase.app';
initializeApp(
  emulator
    ? { projectId: 'demo-institute', databaseURL: DATABASE_URL }
    : { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: DATABASE_URL },
);
const db = getFirestore();

// --- Has anything changed since the last run? (a few cheap reads) -------------------------

async function fingerprint() {
  const count = async (q) => (await q.count().get()).data().count;
  const latest = async (group) => {
    const snap = await db.collectionGroup(group).orderBy('updatedAt', 'desc').limit(1).get();
    return snap.empty ? null : snap.docs[0].get('updatedAt').toMillis();
  };
  return {
    members: await count(db.collection('members')),
    lists: await count(db.collectionGroup('lists')),
    entries: await count(db.collectionGroup('entries')),
    listsUpdated: await latest('lists'),
    entriesUpdated: await latest('entries'),
  };
}

const force = process.argv.includes('--force');
const now = await fingerprint();
const sourceRef = db.doc('stats/source');
const before = (await sourceRef.get()).data();
if (!force && before && JSON.stringify(before.fingerprint) === JSON.stringify(now)) {
  console.log('No changes since the last run.', now);
  process.exit(0);
}

// --- Read everything once -------------------------------------------------------------------

const listDocs = (await db.collectionGroup('lists').get()).docs;
const lists = listDocs.map((d) => d.data());
const listNames = new Map(listDocs.map((d) => [d.id, d.get('name')]));
const members = new Map((await db.collection('members').get()).docs.map((d) => [d.id, { name: d.get('name'), photo: d.get('photo') ?? null }]));
// Only entries that belong to a list (anything older is left over from before lists existed).
const entries = (await db.collectionGroup('entries').get()).docs.map((d) => d.data()).filter((e) => e.listId);

const byKind = (rows) => Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]));
const distinct = Object.fromEntries(KINDS.map((k) => [k, new Set(entries.filter((e) => e.kind === k).map((e) => e.itemId)).size]));
const totals = {
  members: now.members,
  lists: byKind(lists),
  entries: byKind(entries),
  distinct,
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => Math.round(x * 10) / 10;

function itemMetrics(scoped) {
  const items = new Map();
  for (const e of scoped) {
    let it = items.get(e.itemId);
    if (!it) {
      it = { itemId: e.itemId, kind: e.kind, title: e.title, artist: e.artist ?? '', year: e.year ?? null, image: e.image ?? null, lists: 0, scores: new Map() };
      items.set(e.itemId, it);
    }
    it.lists++;
    it.scores.set(e.uid, [...(it.scores.get(e.uid) ?? []), e.score]);
  }
  const rows = [...items.values()].map(({ scores, ...it }) => {
    // Each member counts once: their own average across their lists.
    const perMember = [...scores.values()].map(mean);
    return {
      ...it,
      members: scores.size,
      average: round1(mean(perMember)),
      low: Math.min(...perMember),
      high: Math.max(...perMember),
      spread: round1(Math.sqrt(mean(perMember.map((x) => (x - mean(perMember)) ** 2)))),
    };
  });

  const mostRanked = {};
  const topScored = {};
  const divisive = {};
  for (const k of KINDS) {
    const ofKind = rows.filter((r) => r.kind === k);
    mostRanked[k] = [...ofKind].sort((a, b) => b.lists - a.lists || b.members - a.members || b.average - a.average).slice(0, TOP);
    topScored[k] = ofKind
      .filter((r) => r.members >= MIN_MEMBERS)
      .sort((a, b) => b.average - a.average || b.members - a.members)
      .slice(0, TOP);
    // Most divisive: the biggest disagreement (spread of members' scores), same minimum of members.
    divisive[k] = ofKind
      .filter((r) => r.members >= MIN_MEMBERS && r.spread > 0)
      .sort((a, b) => b.spread - a.spread || b.members - a.members)
      .slice(0, TOP);
  }

  const tagCounts = new Map();
  for (const e of scoped) for (const t of e.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);

  // Decades of the different albums (songs and bands have no release year here; concerts are not albums).
  const decadeCounts = new Map();
  for (const r of rows) if (r.kind === 'album' && r.year) decadeCounts.set(Math.floor(r.year / 10) * 10, (decadeCounts.get(Math.floor(r.year / 10) * 10) ?? 0) + 1);
  const decades = [...decadeCounts].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade);

  return { mostRanked, topScored, divisive, tags, decades };
}

/** The newest entries, for the feed. A public entry is in a public list, so its member's profile is public too. */
const RECENT = 20;
const recent = (scoped) =>
  scoped
    .filter((e) => e.createdAt && members.has(e.uid))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    .slice(0, RECENT)
    .map((e) => ({
      uid: e.uid,
      member: members.get(e.uid).name,
      photo: members.get(e.uid).photo,
      listId: e.listId,
      listName: listNames.get(e.listId) ?? '',
      kind: e.kind,
      itemId: e.itemId,
      title: e.title,
      artist: e.artist ?? '',
      year: e.year ?? null,
      image: e.image ?? null,
      score: e.score,
      tags: e.tags ?? [],
      at: e.createdAt,
    }));

const write = (id, scoped) =>
  db.doc(`stats/${id}`).set({
    computedAt: FieldValue.serverTimestamp(),
    minMembers: MIN_MEMBERS,
    totals,
    ...itemMetrics(scoped),
    recent: recent(scoped),
  });

await write('public', entries.filter((e) => e.visibility === 'public'));
await write('members', entries.filter((e) => e.visibility === 'public' || e.visibility === 'members'));
// --- Announce new additions to public lists in #institute ------------------------------------

const BOT = { uid: 'institute-bot', nick: 'TheInstitute' };
const CHANNEL = 'institute';
const MAX_ANNOUNCE = 10;

const fmtScore = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
function announcement(e) {
  const who = members.get(e.uid)?.name ?? 'Someone';
  const list = listNames.get(e.listId) ?? '';
  if (e.kind === 'concert') {
    const date = /_(\d{4}-\d{2}-\d{2})$/.exec(e.itemId)?.[1] ?? '';
    return `${who} was at ${e.title} (${[e.artist, date].filter(Boolean).join(', ')}) — ${fmtScore(e.score)}, in "${list}"`;
  }
  return `${who} added ${e.title}${e.artist ? ` (${e.artist})` : ''} to "${list}" — ${fmtScore(e.score)}`;
}

async function announce(since) {
  const rtdb = getDatabase();
  if (!(await rtdb.ref(`channels/${CHANNEL}/createdBy`).get()).exists()) return;
  // Reserve the bot's nick so nobody else can take it.
  await rtdb.ref().update({ [`users/${BOT.uid}/nick`]: BOT.nick, [`nicks/${BOT.nick.toLowerCase()}`]: BOT.uid });
  const fresh = entries
    .filter((e) => e.visibility === 'public' && e.createdAt && e.createdAt.toMillis() > since)
    .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  const lines = fresh.slice(0, MAX_ANNOUNCE).map(announcement);
  if (fresh.length > MAX_ANNOUNCE) lines.push(`…and ${fresh.length - MAX_ANNOUNCE} more. See the home page.`);
  const changes = {};
  for (const text of lines) {
    changes[`messages/${CHANNEL}/${rtdb.ref(`messages/${CHANNEL}`).push().key}`] = { uid: BOT.uid, nick: BOT.nick, type: 'notice', text: text.slice(0, 500), at: ServerValue.TIMESTAMP };
  }
  if (lines.length) await rtdb.ref().update(changes);
  console.log(`Announced ${lines.length} line(s).`);
}

// The first run only starts the clock, so old additions aren't announced all at once.
const announcedAt = before?.announcedAt ?? Date.now();
try {
  await Promise.race([announce(announcedAt), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 20000))]);
} catch (e) {
  console.log('Announcements skipped:', e.message);
}

await sourceRef.set({ fingerprint: now, computedAt: FieldValue.serverTimestamp(), announcedAt: Date.now() });
console.log('Stats written.', totals);

process.exit(0);
