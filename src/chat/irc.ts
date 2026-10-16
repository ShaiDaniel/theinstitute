// The chat's data, in the Realtime Database (rules: database.rules.json):
//   nicks/{nick}               uid that owns the nick (lowercase), so nicks are unique
//   users/{uid}/nick           the nick as typed
//   presence/{uid}             {nick, at, away?} while connected (removed on disconnect)
//   channels/{chan}            {createdBy, createdAt, topic, ops, voice, bans, modes}; never removed
//   occupants/{chan}/{uid}     {nick, at}: in the channel until /part or a kick, online or not
//                              (like a bouncer; presence says who is online right now)
//   messages/{chan}/{id}       {uid, nick, type, text, at}, kept as the channel's log
//   pm/{uidA_uidB}/{id}        private messages between two people
//   pmIndex/{uid}/{otherUid}   {at}: who has written to whom, so new conversations open
//   rate/{uid}                 time of the last post: the rules allow one per 0.7 s
// Channel names are stored without the "#".
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type DatabaseReference,
} from 'firebase/database';
import { app, usingEmulators } from '../firebase';

export const rtdb = getDatabase(app);
if (usingEmulators) connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);

export const NICK_RE = /^[A-Za-z_{}^|`][A-Za-z0-9_{}^|`-]{0,19}$/;
export const CHAN_RE = /^#?([a-z0-9_-]{1,30})$/i;
export const TEXT_MAX = 500;
const RESERVED = ['chanserv', 'nickserv', 'memoserv', 'operserv', 'botserv', 'admin', 'root', 'system', 'institute', 'bot'];

export type MessageType = 'msg' | 'action' | 'join' | 'part' | 'topic' | 'nick' | 'kick' | 'mode' | 'notice';

export interface Message {
  id: string;
  uid: string;
  nick: string;
  type: MessageType;
  text: string;
  at: number;
}

export interface Channel {
  topic: { text: string; nick: string; at: number } | null;
  ops: Record<string, true>;
  voice: Record<string, true>;
  bans: Record<string, true>;
  modes: { m?: boolean; t?: boolean };
}

export interface Occupant {
  uid: string;
  nick: string;
}

export const chanName = (input: string) => CHAN_RE.exec(input.trim())?.[1].toLowerCase() ?? null;
export const pairId = (a: string, b: string) => [a, b].sort().join('_');
const now = serverTimestamp;

export function nickProblem(nick: string): 'nickInvalid' | 'nickReserved' | null {
  if (!NICK_RE.test(nick)) return 'nickInvalid';
  if (RESERVED.includes(nick.toLowerCase())) return 'nickReserved';
  return null;
}

/** "Shai Daniel" → "ShaiDaniel": a starting nick from a name. */
export const suggestNick = (name: string) =>
  name
    .replace(/[^A-Za-z0-9_{}^|`-]/g, '')
    .replace(/^[0-9-]+/, '')
    .slice(0, 20);

// --- Posting, at most one write per 0.7 s (the rules refuse faster ones) ---------------------

let lastPost = 0;
let postQueue: Promise<unknown> = Promise.resolve();

/** Runs a write that includes the rate stamp, waiting first if the last one was too recent. */
function throttled(write: (stamp: Record<string, object>) => Promise<void>, uid: string) {
  const run = async () => {
    const wait = lastPost + 750 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastPost = Date.now();
    await write({ [`rate/${uid}`]: now() });
  };
  const p = postQueue.then(run, run);
  postQueue = p.catch(() => {});
  return p;
}

const messageAt = (path: string, uid: string, nick: string, type: MessageType, text: string) => {
  const id = push(ref(rtdb, path)).key!;
  return { [`${path}/${id}`]: { uid, nick, type, text: text.slice(0, TEXT_MAX), at: now() } };
};

export const say = (uid: string, nick: string, chan: string, text: string, type: MessageType = 'msg') =>
  throttled((stamp) => update(ref(rtdb), { ...stamp, ...messageAt(`messages/${chan}`, uid, nick, type, text) }), uid);

export const sayPrivately = (uid: string, nick: string, other: string, text: string, type: 'msg' | 'action' = 'msg') =>
  throttled(
    (stamp) =>
      update(ref(rtdb), {
        ...stamp,
        ...messageAt(`pm/${pairId(uid, other)}`, uid, nick, type, text),
        [`pmIndex/${other}/${uid}`]: { at: now() },
        [`pmIndex/${uid}/${other}`]: { at: now() },
      }),
    uid,
  );

// --- Nicks ---------------------------------------------------------------------------------

export async function myNick(uid: string): Promise<string | null> {
  return (await get(ref(rtdb, `users/${uid}/nick`))).val();
}

export async function uidOfNick(nick: string): Promise<string | null> {
  if (!NICK_RE.test(nick)) return null;
  return (await get(ref(rtdb, `nicks/${nick.toLowerCase()}`))).val();
}

export class NickTaken extends Error {}

/** Takes a nick (first time) or changes it, telling every channel the member is in. */
export async function setNick(uid: string, nick: string, old: string | null, channels: string[]) {
  const owner = await uidOfNick(nick);
  if (owner && owner !== uid) throw new NickTaken();
  const changes: Record<string, unknown> = { [`users/${uid}/nick`]: nick, [`nicks/${nick.toLowerCase()}`]: uid };
  if (old && old.toLowerCase() !== nick.toLowerCase()) changes[`nicks/${old.toLowerCase()}`] = null;
  if (!old) {
    await update(ref(rtdb), changes);
    return;
  }
  changes[`presence/${uid}/nick`] = nick;
  for (const chan of channels) {
    changes[`occupants/${chan}/${uid}/nick`] = nick;
    Object.assign(changes, messageAt(`messages/${chan}`, uid, nick, 'nick', old));
  }
  try {
    await throttled((stamp) => update(ref(rtdb), { ...stamp, ...changes }), uid);
  } catch (e) {
    if (await uidOfNick(nick).then((o) => o && o !== uid)) throw new NickTaken();
    throw e;
  }
}

// --- Presence ------------------------------------------------------------------------------

/** Marks the member online for as long as the page is connected. Returns a function to stop. */
export function goOnline(uid: string, nick: string): () => void {
  const me = ref(rtdb, `presence/${uid}`);
  const stop = onValue(ref(rtdb, '.info/connected'), async (snap) => {
    if (snap.val() !== true) return;
    await onDisconnect(me).remove();
    await set(me, { nick, at: now() });
  });
  return () => {
    stop();
    remove(me).catch(() => {});
  };
}

export const setAway = (uid: string, away: string | null) =>
  away ? update(ref(rtdb, `presence/${uid}`), { away: away.slice(0, 200) }) : remove(ref(rtdb, `presence/${uid}/away`));

// --- Channels ------------------------------------------------------------------------------

const occupantRef = (chan: string, uid: string): DatabaseReference => ref(rtdb, `occupants/${chan}/${uid}`);

export class Banned extends Error {}

/** The channels the member is in (they stay in them until they /part, even when offline). */
export async function myChannels(uid: string): Promise<string[]> {
  const all = await allOccupants();
  return Object.entries(all)
    .filter(([, people]) => uid in people)
    .sort(([, a], [, b]) => ((a as Record<string, { at?: number }>)[uid]?.at ?? 0) - ((b as Record<string, { at?: number }>)[uid]?.at ?? 0))
    .map(([chan]) => chan);
}

/** Joins a channel, creating it (with the member as op) if nobody has yet. */
export async function join(uid: string, nick: string, chan: string) {
  const exists = (await get(ref(rtdb, `channels/${chan}/createdBy`))).exists();
  if (!exists) {
    await update(ref(rtdb), { [`channels/${chan}/createdBy`]: uid, [`channels/${chan}/createdAt`]: now(), [`channels/${chan}/ops/${uid}`]: true });
  }
  try {
    await set(occupantRef(chan, uid), { nick, at: now() });
  } catch (e) {
    if ((await get(ref(rtdb, `channels/${chan}/bans/${uid}`))).exists()) throw new Banned();
    throw e;
  }
  await say(uid, nick, chan, '', 'join').catch(() => {});
}

export async function part(uid: string, nick: string, chan: string, reason = '') {
  await say(uid, nick, chan, reason, 'part').catch(() => {});
  await remove(occupantRef(chan, uid));
}

export const setTopic = (uid: string, nick: string, chan: string, text: string) =>
  throttled(
    (stamp) =>
      update(ref(rtdb), {
        ...stamp,
        [`channels/${chan}/topic`]: { text: text.slice(0, 300), nick, at: now() },
        ...messageAt(`messages/${chan}`, uid, nick, 'topic', text),
      }),
    uid,
  );

/** Op actions: +o/-o, +v/-v, +b/-b on a member, or a channel mode. */
export async function setFlag(uid: string, nick: string, chan: string, flag: 'ops' | 'voice' | 'bans', target: string, on: boolean, label: string) {
  await set(ref(rtdb, `channels/${chan}/${flag}/${target}`), on ? true : null);
  await say(uid, nick, chan, label, 'mode').catch(() => {});
}

export async function setMode(uid: string, nick: string, chan: string, mode: 'm' | 't', on: boolean) {
  await set(ref(rtdb, `channels/${chan}/modes/${mode}`), on);
  await say(uid, nick, chan, `${on ? '+' : '-'}${mode}`, 'mode').catch(() => {});
}

export async function kick(uid: string, nick: string, chan: string, target: { uid: string; nick: string }, reason: string) {
  await remove(occupantRef(chan, target.uid));
  await say(uid, nick, chan, `${target.nick} ${reason}`.trim(), 'kick').catch(() => {});
}

/** Everyone currently in any channel, by channel. */
export async function allOccupants(): Promise<Record<string, Record<string, { nick: string; at?: number }>>> {
  return (await get(ref(rtdb, 'occupants'))).val() ?? {};
}

export async function channelList(): Promise<{ name: string; users: number; topic: string }[]> {
  const [channels, occupants] = await Promise.all([get(ref(rtdb, 'channels')), allOccupants()]);
  const all = (channels.val() ?? {}) as Record<string, Partial<Channel>>;
  return Object.entries(all)
    .map(([name, c]) => ({ name, users: Object.keys(occupants[name] ?? {}).length, topic: c.topic?.text ?? '' }))
    .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
}

export async function whois(nick: string) {
  const uid = await uidOfNick(nick);
  if (!uid) return null;
  const [presence, occupants] = await Promise.all([get(ref(rtdb, `presence/${uid}`)), allOccupants()]);
  const p = presence.val() as { nick: string; away?: string } | null;
  return {
    uid,
    nick: (await get(ref(rtdb, `users/${uid}/nick`))).val() as string,
    online: p !== null,
    away: p?.away ?? null,
    channels: Object.entries(occupants)
      .filter(([, people]) => uid in people)
      .map(([chan]) => chan),
  };
}
