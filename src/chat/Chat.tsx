// The chat: an imitation of mIRC. A switchbar of windows (status, channels, private messages),
// the conversation, the nick list (@ ops, + voice, away greyed) and a command line that takes
// /join, /part, /me, /nick, /topic, /away, /whois, /msg, /query, /op, /deop, /voice, /devoice,
// /kick, /ban, /unban, /mode, /list, /clear, /close and /help. Data and rules: irc.ts.
import { get, limitToLast, onChildAdded, onValue, query, ref } from 'firebase/database';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSession } from '../auth';
import { signIn } from '../firebase';
import { useI18n } from '../i18n';
import { hrefOf } from '../route';
import { BOLD, COLOR, COLOR_NAMES, Formatted, ITALIC, PALETTE, RESET, UNDERLINE } from './format';
import {
  Banned,
  chanName,
  channelList,
  goOnline,
  join,
  kick,
  myNick,
  nickProblem,
  NickTaken,
  pairId,
  part,
  rtdb,
  say,
  sayPrivately,
  setAway,
  setFlag,
  setMode,
  setNick,
  setTopic,
  suggestNick,
  TEXT_MAX,
  uidOfNick,
  whois,
  type Channel,
  type Message,
} from './irc';

const DEFAULT_CHANNEL = 'institute';
const LOG_SIZE = 200;

type Win = { kind: 'status' } | { kind: 'channel'; chan: string } | { kind: 'pm'; uid: string; nick: string };
const keyOf = (w: Win) => (w.kind === 'status' ? 'status' : w.kind === 'channel' ? `#${w.chan}` : `pm:${w.uid}`);
const titleOf = (w: Win) => (w.kind === 'status' ? 'Status' : w.kind === 'channel' ? `#${w.chan}` : w.nick);

/** A line shown in a window: a stored message, or something only this member sees. */
interface Line {
  id: string;
  at: number;
  kind: 'msg' | 'action' | 'event' | 'local' | 'error';
  nick?: string;
  text: string;
  /** The event's colour class, mIRC style. */
  tone?: 'join' | 'part' | 'topic' | 'kick' | 'mode' | 'nick' | 'notice';
}

const time = (at: number) => {
  const d = new Date(at);
  return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
};

function toLine(m: Message, where: string): Line {
  const base = { id: m.id, at: m.at, nick: m.nick };
  switch (m.type) {
    case 'msg':
      return { ...base, kind: 'msg', text: m.text };
    case 'action':
      return { ...base, kind: 'action', text: m.text };
    case 'join':
      return { ...base, kind: 'event', tone: 'join', text: `* ${m.nick} has joined ${where}` };
    case 'part':
      return { ...base, kind: 'event', tone: 'part', text: `* ${m.nick} has left ${where}${m.text ? ` (${m.text})` : ''}` };
    case 'topic':
      return { ...base, kind: 'event', tone: 'topic', text: `* ${m.nick} changes topic to '${m.text}'` };
    case 'nick':
      return { ...base, kind: 'event', tone: 'nick', text: `* ${m.text} is now known as ${m.nick}` };
    case 'kick': {
      const [target, ...reason] = m.text.split(' ');
      return { ...base, kind: 'event', tone: 'kick', text: `* ${target} was kicked by ${m.nick}${reason.length ? ` (${reason.join(' ')})` : ''}` };
    }
    case 'mode':
      return { ...base, kind: 'event', tone: 'mode', text: `* ${m.nick} sets mode: ${m.text}` };
    default:
      return { ...base, kind: 'event', tone: 'notice', text: `-${m.nick}- ${m.text}` };
  }
}

const HELP = [
  '/join #channel — join or create a channel',
  '/part [reason] — leave this channel',
  '/me does something — an action',
  '/nick NewNick — change your nick',
  '/topic [text] — show or set the topic',
  '/away [message] — set away; /away alone to come back',
  '/whois nick — who is it, where are they',
  '/msg nick text — private message; /query nick opens a window',
  '/op /deop /voice /devoice nick — ops only',
  '/kick nick [reason], /ban nick, /unban nick — ops only',
  '/mode +m|-m|+t|-t — moderated; only ops set the topic',
  '/list — channels; /clear — clear this window; /close — close this window',
  'Ctrl+K colour, Ctrl+B bold, Ctrl+U underline, Ctrl+I italic, Ctrl+O plain',
];

// --- Entry: sign in, then a nick -----------------------------------------------------------

export default function Chat() {
  const { t } = useI18n();
  const { ready, user, member } = useSession();
  const [nick, setNickState] = useState<string | null | 'loading'>('loading');

  useEffect(() => {
    if (!user) return;
    let live = true;
    myNick(user.uid)
      .then((n) => live && setNickState(n))
      .catch(() => live && setNickState(null));
    return () => {
      live = false;
    };
  }, [user]);

  if (!ready) return null;
  if (!user || !member) {
    return (
      <main className="placeholder">
        <p>{t('chatIntro')}</p>
        <p>{t(user ? 'chatNeedsProfile' : 'chatSignIn')}</p>
        {!user ? (
          <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
            {t('signIn')}
          </button>
        ) : (
          <a className="btn primary" href={hrefOf('me')}>
            {t('createProfile')}
          </a>
        )}
      </main>
    );
  }
  if (nick === 'loading') return <main className="placeholder">{t('loading')}</main>;
  if (!nick) return <NickPicker uid={user.uid} name={member.name} onDone={setNickState} />;
  return <Irc uid={user.uid} initialNick={nick} />;
}

function NickPicker({ uid, name, onDone }: { uid: string; name: string; onDone: (n: string) => void }) {
  const { t } = useI18n();
  const [nick, setNick_] = useState(suggestNick(name));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const problem = nickProblem(nick);
    if (problem) return setError(t(problem));
    setBusy(true);
    setError(null);
    try {
      await setNick(uid, nick, null, []);
      onDone(nick);
    } catch (e) {
      setError(t(e instanceof NickTaken ? 'nickTaken' : 'saveError'));
      setBusy(false);
    }
  };
  return (
    <main className="panel">
      <h2>{t('chooseNick')}</h2>
      <p className="muted small">{t('chooseNickHint')}</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input className="nick-input" value={nick} maxLength={20} onChange={(e) => setNick_(e.target.value)} autoFocus />
        <button type="submit" className="btn primary" disabled={busy || !nick}>
          {t('connect')}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted small">{t('chatNotEncrypted')}</p>
    </main>
  );
}

// --- The client ----------------------------------------------------------------------------

const savedChannels = (uid: string): string[] => {
  try {
    const x = JSON.parse(localStorage.getItem(`chat:${uid}:channels`) ?? 'null');
    if (Array.isArray(x) && x.every((c) => typeof c === 'string')) return x;
  } catch {
    // Not remembered.
  }
  return [DEFAULT_CHANNEL];
};

function Irc({ uid, initialNick }: { uid: string; initialNick: string }) {
  const { t } = useI18n();
  const [nick, setNickState] = useState(initialNick);
  const [windows, setWindows] = useState<Win[]>([{ kind: 'status' }]);
  const [active, setActive] = useState('status');
  const [local, setLocal] = useState<Record<string, Line[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [presence, setPresence] = useState<Record<string, { nick: string; away?: string }>>({});
  const [away, setAwayState] = useState<string | null>(null);
  const nickRef = useRef(nick);
  nickRef.current = nick;
  const startedAt = useRef(Date.now());
  const topics = useRef<Record<string, string>>({});
  const clearedAt = useRef<Record<string, number>>({});

  const channels = windows.filter((w): w is Extract<Win, { kind: 'channel' }> => w.kind === 'channel').map((w) => w.chan);
  const activeWin = windows.find((w) => keyOf(w) === active) ?? windows[0];

  const echo = useCallback((key: string, text: string, kind: Line['kind'] = 'local') => {
    setLocal((cur) => ({ ...cur, [key]: [...(cur[key] ?? []), { id: `local-${Date.now()}-${Math.random()}`, at: Date.now(), kind, text }] }));
  }, []);

  const openWindow = useCallback((w: Win, focus = true) => {
    setWindows((cur) => (cur.some((x) => keyOf(x) === keyOf(w)) ? cur : [...cur, w]));
    if (focus) setActive(keyOf(w));
  }, []);

  const closeWindow = useCallback((key: string) => {
    setWindows((cur) => cur.filter((w) => keyOf(w) !== key));
    setActive((cur) => (cur === key ? 'status' : cur));
  }, []);

  // Online while this page is open; everyone's presence for the nick lists and /whois.
  useEffect(() => goOnline(uid, nick), [uid]);
  useEffect(() => onValue(ref(rtdb, 'presence'), (s) => setPresence(s.val() ?? {})), []);

  // Rejoin the channels from last time (once, even where React runs effects twice in development).
  const started = useRef(false);
  const restored = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    echo('status', `*** Welcome to The Institute's chat, ${nick}. Type /help for commands.`);
    echo('status', `*** ${t('chatNotEncrypted')}`);
    (async () => {
      const saved = savedChannels(uid);
      for (const chan of saved) {
        try {
          await join(uid, nickRef.current, chan);
          openWindow({ kind: 'channel', chan }, chan === saved[0]);
        } catch (e) {
          echo('status', `*** Cannot join #${chan}${e instanceof Banned ? ' (banned)' : ''}`, 'error');
        }
      }
      restored.current = true;
    })();
  }, []);

  // Remember joined channels for next time (not before last time's have been rejoined).
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(`chat:${uid}:channels`, JSON.stringify(channels));
    } catch {
      // Not remembered.
    }
  }, [channels.join(',')]);

  // New private conversations open their own window.
  useEffect(
    () =>
      onChildAdded(ref(rtdb, `pmIndex/${uid}`), async (snap) => {
        const other = snap.key!;
        const at = (snap.val() as { at: number }).at;
        if (at < startedAt.current - 60_000) return;
        const s = await get(ref(rtdb, `users/${other}/nick`));
        openWindow({ kind: 'pm', uid: other, nick: (s.val() as string) ?? '?' }, false);
      }),
    [uid],
  );

  const noteUnread = useCallback((key: string) => setUnread((u) => ({ ...u, [key]: (u[key] ?? 0) + 1 })), []);
  useEffect(() => setUnread((u) => ({ ...u, [active]: 0 })), [active]);

  const run = async (input: string) => {
    const where = keyOf(activeWin);
    const chan = activeWin.kind === 'channel' ? activeWin.chan : null;
    const needChan = () => {
      if (!chan) throw new Error('Not on a channel. Use /join #channel');
      return chan;
    };
    const nickToUid = async (n: string) => {
      const target = await uidOfNick(n);
      if (!target) throw new Error(`${n}: No such nick`);
      return target;
    };

    if (!input.startsWith('/') || input.startsWith('//')) {
      const text = input.startsWith('//') ? input.slice(1) : input;
      if (activeWin.kind === 'channel') return say(uid, nick, activeWin.chan, text);
      if (activeWin.kind === 'pm') return sayPrivately(uid, nick, activeWin.uid, text);
      throw new Error('Not on a channel. Use /join #channel');
    }

    const [cmd, ...args] = input.slice(1).split(' ');
    const rest = args.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'help':
        HELP.forEach((h) => echo(where, h));
        return;
      case 'join':
      case 'j': {
        const c = chanName(args[0] ?? '');
        if (!c) throw new Error('Usage: /join #channel (letters, digits, - and _)');
        if (channels.includes(c)) return setActive(`#${c}`);
        try {
          await join(uid, nick, c);
        } catch (e) {
          throw new Error(e instanceof Banned ? `Cannot join #${c} (you are banned)` : `Cannot join #${c}`);
        }
        openWindow({ kind: 'channel', chan: c });
        return;
      }
      case 'part':
      case 'leave': {
        const named = args[0]?.startsWith('#') ? chanName(args[0]) : null;
        const c = named ?? needChan();
        await part(uid, nick, c, named ? args.slice(1).join(' ') : rest);
        closeWindow(`#${c}`);
        return;
      }
      case 'me':
        if (!rest) throw new Error('Usage: /me does something');
        if (activeWin.kind === 'pm') return sayPrivately(uid, nick, activeWin.uid, rest, 'action');
        return say(uid, nick, needChan(), rest, 'action');
      case 'nick': {
        const n = args[0] ?? '';
        const problem = nickProblem(n);
        if (problem) throw new Error(t(problem));
        try {
          await setNick(uid, n, nick, channels);
        } catch (e) {
          throw new Error(e instanceof NickTaken ? `${n}: Nickname is already in use` : 'Could not change nick');
        }
        setNickState(n);
        echo('status', `*** You are now known as ${n}`);
        return;
      }
      case 'topic': {
        const c = needChan();
        if (!rest) {
          echo(where, `*** Topic: ${topics.current[c] || '(none)'}`);
          return;
        }
        try {
          await setTopic(uid, nick, c, rest);
        } catch {
          throw new Error(`#${c}: You're not a channel operator (+t)`);
        }
        return;
      }
      case 'away':
        await setAway(uid, rest || null);
        setAwayState(rest || null);
        echo(where, rest ? `*** You have been marked as away: ${rest}` : '*** You are no longer marked as away');
        return;
      case 'whois': {
        const w = await whois(args[0] ?? '');
        if (!w) throw new Error(`${args[0] ?? ''}: No such nick`);
        echo(where, `*** ${w.nick} is ${w.online ? 'online' : 'not online'}${w.away ? ` — away: ${w.away}` : ''}`);
        echo(where, `*** ${w.nick} on: ${w.channels.length ? w.channels.map((c) => `#${c}`).join(' ') : '(no channels)'}`);
        echo(where, `*** ${w.nick}'s page: ${location.origin}${location.pathname}${hrefOf({ page: 'member', uid: w.uid })}`);
        return;
      }
      case 'msg':
      case 'query': {
        const target = args[0] ?? '';
        const other = await nickToUid(target);
        if (other === uid) throw new Error('That is you');
        const shownNick = (await whois(target))?.nick ?? target;
        openWindow({ kind: 'pm', uid: other, nick: shownNick });
        const text = args.slice(1).join(' ');
        if (cmd.toLowerCase() === 'msg' && text) await sayPrivately(uid, nick, other, text);
        return;
      }
      case 'op':
      case 'deop':
      case 'voice':
      case 'devoice':
      case 'ban':
      case 'unban': {
        const c = needChan();
        const target = args[0] ?? '';
        const targetUid = await nickToUid(target);
        const c2 = cmd.toLowerCase();
        const flag = c2.endsWith('op') ? 'ops' : c2.endsWith('voice') ? 'voice' : 'bans';
        const on = !c2.startsWith('de') && !c2.startsWith('un');
        const letter = flag === 'ops' ? 'o' : flag === 'voice' ? 'v' : 'b';
        try {
          await setFlag(uid, nick, c, flag, targetUid, on, `${on ? '+' : '-'}${letter} ${target}`);
          if (flag === 'bans' && on) await kick(uid, nick, c, { uid: targetUid, nick: target }, 'banned');
        } catch {
          throw new Error(`#${c}: You're not a channel operator`);
        }
        return;
      }
      case 'kick': {
        const c = needChan();
        const target = args[0] ?? '';
        const targetUid = await nickToUid(target);
        try {
          await kick(uid, nick, c, { uid: targetUid, nick: target }, args.slice(1).join(' '));
        } catch {
          throw new Error(`#${c}: You're not a channel operator`);
        }
        return;
      }
      case 'mode': {
        const spec = args.find((a) => /^[+-][mt]$/.test(a));
        if (!spec) throw new Error('Usage: /mode +m|-m|+t|-t');
        const c = needChan();
        try {
          await setMode(uid, nick, c, spec[1] as 'm' | 't', spec[0] === '+');
        } catch {
          throw new Error(`#${c}: You're not a channel operator`);
        }
        return;
      }
      case 'list': {
        const list = await channelList();
        echo(where, '*** Channel   Users   Topic');
        list.forEach((c) => echo(where, `*** #${c.name}   ${c.users}   ${c.topic}`));
        echo(where, '*** End of /list');
        return;
      }
      case 'clear':
        clearedAt.current[where] = Date.now();
        setLocal((cur) => ({ ...cur, [where]: [] }));
        return;
      case 'close':
        if (activeWin.kind === 'status') throw new Error('The status window stays open');
        if (activeWin.kind === 'channel') {
          await part(uid, nick, activeWin.chan);
        }
        closeWindow(where);
        return;
      default:
        throw new Error(`Unknown command: /${cmd}. Type /help`);
    }
  };

  const submit = async (input: string) => {
    if (!input.trim()) return;
    try {
      await run(input.slice(0, TEXT_MAX));
    } catch (e) {
      echo(keyOf(activeWin), `*** ${(e as Error).message ?? 'Failed'}`, 'error');
    }
  };

  return (
    // IRC reads left to right even in Hebrew; each message lays out its own text (<bdi>).
    <main className="irc" dir="ltr">
      <div className="irc-titlebar">
        <span>The Institute — {nick}{away ? ' (away)' : ''}</span>
      </div>
      <div className="irc-body">
        <nav className="irc-switchbar" aria-label="Windows">
          {windows.map((w) => {
            const k = keyOf(w);
            return (
              <button key={k} type="button" className={`${k === active ? 'active' : ''} ${unread[k] ? 'unread' : ''}`} onClick={() => setActive(k)}>
                {titleOf(w)}
              </button>
            );
          })}
        </nav>
        {windows.map((w) => {
          const k = keyOf(w);
          const props = {
            hidden: k !== active,
            local: local[k] ?? [],
            clearedAt: clearedAt.current[k] ?? 0,
            onNew: () => k !== active && noteUnread(k),
          };
          if (w.kind === 'status') return <Status key={k} {...props} />;
          if (w.kind === 'pm') return <PrivateWindow key={k} {...props} me={uid} other={w.uid} nick={w.nick} />;
          return (
            <ChannelWindow
              key={k}
              {...props}
              chan={w.chan}
              me={uid}
              presence={presence}
              onTopic={(text) => (topics.current[w.chan] = text)}
              onKicked={() => {
                closeWindow(k);
                echo('status', `*** You were kicked from #${w.chan}`, 'error');
              }}
              onQuery={(other, n) => openWindow({ kind: 'pm', uid: other, nick: n })}
            />
          );
        })}
      </div>
      <InputLine onSubmit={submit} placeholder={activeWin.kind === 'status' ? '/join #institute' : `${titleOf(activeWin)}…`} />
    </main>
  );
}

// --- Windows -------------------------------------------------------------------------------

interface WindowProps {
  hidden: boolean;
  local: Line[];
  clearedAt: number;
  onNew: () => void;
}

function Lines({ lines, hidden }: { lines: Line[]; hidden: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, hidden]);
  return (
    <div
      className="irc-lines"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {lines.map((l) => (
        <div key={l.id} className={`irc-line ${l.kind} ${l.tone ?? ''}`}>
          <span className="irc-time">{time(l.at)} </span>
          {l.kind === 'msg' ? (
            <>
              <span className="irc-nick">&lt;{l.nick}&gt;</span>{' '}
              <bdi>
                <Formatted text={l.text} />
              </bdi>
            </>
          ) : l.kind === 'action' ? (
            <>
              * {l.nick}{' '}
              <bdi>
                <Formatted text={l.text} />
              </bdi>
            </>
          ) : (
            <bdi>
              <Formatted text={l.text} />
            </bdi>
          )}
        </div>
      ))}
    </div>
  );
}

const merge = (stored: Line[], local: Line[], clearedAt: number) => [...stored, ...local].filter((l) => l.at >= clearedAt).sort((a, b) => a.at - b.at);

function Status({ hidden, local, clearedAt }: WindowProps) {
  return (
    <section className="irc-window" hidden={hidden}>
      <div className="irc-main">
        <Lines lines={merge([], local, clearedAt)} hidden={hidden} />
      </div>
    </section>
  );
}

/** Subscribes to a log (channel or private) and returns its lines. */
function useLog(path: string, where: string, onNew: () => void) {
  const [lines, setLines] = useState<Line[]>([]);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    setLines([]);
    const loadedAt = Date.now();
    return onChildAdded(query(ref(rtdb, path), limitToLast(LOG_SIZE)), (snap) => {
      const m = { id: snap.key!, ...(snap.val() as Omit<Message, 'id'>) };
      setLines((cur) => [...cur, toLine(m, where)].slice(-LOG_SIZE * 2));
      if (m.at > loadedAt && (m.type === 'msg' || m.type === 'action')) onNewRef.current();
    });
  }, [path, where]);
  return lines;
}

function PrivateWindow({ hidden, local, clearedAt, onNew, me, other, nick }: WindowProps & { me: string; other: string; nick: string }) {
  const lines = useLog(`pm/${pairId(me, other)}`, nick, onNew);
  return (
    <section className="irc-window" hidden={hidden}>
      <div className="irc-topic">
        {nick} — <a href={hrefOf({ page: 'member', uid: other })}>page</a>
      </div>
      <div className="irc-main">
        <Lines lines={merge(lines, local, clearedAt)} hidden={hidden} />
      </div>
    </section>
  );
}

function ChannelWindow({
  hidden,
  local,
  clearedAt,
  onNew,
  chan,
  me,
  presence,
  onTopic,
  onKicked,
  onQuery,
}: WindowProps & {
  chan: string;
  me: string;
  presence: Record<string, { nick: string; away?: string }>;
  onTopic: (t: string) => void;
  onKicked: () => void;
  onQuery: (uid: string, nick: string) => void;
}) {
  const lines = useLog(`messages/${chan}`, `#${chan}`, onNew);
  const [meta, setMeta] = useState<Channel | null>(null);
  const [people, setPeople] = useState<Record<string, { nick: string }>>({});
  const wasIn = useRef(false);
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  useEffect(
    () =>
      onValue(ref(rtdb, `channels/${chan}`), (s) => {
        const c = (s.val() ?? {}) as Partial<Channel>;
        const m: Channel = { topic: c.topic ?? null, ops: c.ops ?? {}, voice: c.voice ?? {}, bans: c.bans ?? {}, modes: c.modes ?? {} };
        setMeta(m);
        onTopic(m.topic?.text ?? '');
      }),
    [chan],
  );
  useEffect(
    () =>
      onValue(ref(rtdb, `occupants/${chan}`), (s) => {
        const p = (s.val() ?? {}) as Record<string, { nick: string }>;
        setPeople(p);
        if (me in p) wasIn.current = true;
        else if (wasIn.current) onKickedRef.current();
      }),
    [chan, me],
  );

  const nicks = useMemo(() => {
    const rank = (u: string) => (meta?.ops[u] ? 0 : meta?.voice[u] ? 1 : 2);
    return Object.entries(people)
      .map(([u, p]) => ({ uid: u, nick: p.nick, rank: rank(u), away: presence[u]?.away }))
      .sort((a, b) => a.rank - b.rank || a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' }));
  }, [people, meta, presence]);

  const modes = meta ? Object.entries(meta.modes).filter(([, on]) => on).map(([m]) => m).join('') : '';

  return (
    <section className="irc-window" hidden={hidden}>
      <div className="irc-topic" title={meta?.topic ? `Set by ${meta.topic.nick}` : undefined}>
        <strong>#{chan}</strong>
        {modes && ` [+${modes}]`}
        {meta?.topic?.text ? (
          <>
            {': '}
            <Formatted text={meta.topic.text} />
          </>
        ) : null}
      </div>
      <div className="irc-main with-nicks">
        <Lines lines={merge(lines, local, clearedAt)} hidden={hidden} />
        <ul className="irc-nicklist" aria-label="Nicks">
          {nicks.map((n) => (
            <li key={n.uid} className={n.away ? 'away' : ''} title={n.away ? `away: ${n.away}` : undefined}>
              <button type="button" onDoubleClick={() => n.uid !== me && onQuery(n.uid, n.nick)}>
                {n.rank === 0 ? '@' : n.rank === 1 ? '+' : ''}
                {n.nick}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// --- The command line, with mIRC's formatting keys -----------------------------------------

function InputLine({ onSubmit, placeholder }: { onSubmit: (s: string) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const [palette, setPalette] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const insert = (code: string) => {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + code + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + code.length, start + code.length);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      const code = k === 'b' ? BOLD : k === 'u' ? UNDERLINE : k === 'i' ? ITALIC : k === 'o' ? RESET : k === 'k' ? COLOR : null;
      if (code) {
        e.preventDefault();
        insert(code);
        if (code === COLOR) setPalette(true);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!text.trim()) return;
      onSubmit(text);
      setHistory((h) => [text, ...h].slice(0, 50));
      setPos(-1);
      setText('');
      setPalette(false);
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const p = Math.min(pos + 1, history.length - 1);
      setPos(p);
      setText(history[p]);
    } else if (e.key === 'ArrowDown' && pos >= 0) {
      e.preventDefault();
      const p = pos - 1;
      setPos(p);
      setText(p >= 0 ? history[p] : '');
    } else if (e.key === 'Escape') {
      setPalette(false);
    }
  };

  // Codes are invisible in an input; show them as mIRC's control-character glyphs.
  return (
    <div className="irc-input">
      {palette && (
        <div className="irc-palette" role="listbox" aria-label="Colours">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              type="button"
              title={`${i} ${COLOR_NAMES[i]}`}
              style={{ background: c }}
              onClick={() => {
                insert(String(i).padStart(2, '0'));
                setPalette(false);
              }}
            />
          ))}
        </div>
      )}
      <button type="button" className="irc-colors" title="Colours (Ctrl+K)" onClick={() => (insert(COLOR), setPalette(true))}>
        🎨
      </button>
      <input
        ref={input}
        value={text}
        maxLength={TEXT_MAX}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        aria-label="Message or /command"
        autoFocus
      />
    </div>
  );
}
