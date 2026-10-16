// The chat: an imitation of mIRC. A switchbar of windows (status, channels, private messages),
// the conversation, the nick list (@ ops, + voice, away greyed) and a command line that takes
// /join, /part, /me, /nick, /topic, /away, /whois, /msg, /query, /op, /deop, /voice, /devoice,
// /kick, /ban, /unban, /mode, /list, /clear, /close and /help, plus a toolbar of macro buttons and a
// help panel (Macros.tsx, Help.tsx). Data and rules: irc.ts.
import { get, limitToLast, onChildAdded, onValue, query, ref } from 'firebase/database';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSession } from '../auth';
import { signIn } from '../firebase';
import { useI18n } from '../i18n';
import { hrefOf } from '../route';
import { BOLD, COLOR, COLOR_NAMES, Formatted, ITALIC, PALETTE, RESET, UNDERLINE } from './format';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { COMMANDS, HelpPanel } from './Help';
import { fillsInput, loadMacros, MacroBar, saveMacros, type Macro } from './Macros';
import {
  Banned,
  chanName,
  channelList,
  goOnline,
  join,
  kick,
  myChannels,
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
/** Who a right-clicked nick is, and (in a channel) their standing there. */
interface NickTarget {
  uid: string;
  nick: string;
  channel?: { iAmOp: boolean; op: boolean; voice: boolean };
}
type OnNickMenu = (e: React.MouseEvent, target: NickTarget) => void;

interface Line {
  id: string;
  at: number;
  kind: 'msg' | 'action' | 'event' | 'local' | 'error';
  nick?: string;
  uid?: string;
  text: string;
  /** The event's colour class, mIRC style. */
  tone?: 'join' | 'part' | 'topic' | 'kick' | 'mode' | 'nick' | 'notice';
}

const time = (at: number) => {
  const d = new Date(at);
  return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
};

function toLine(m: Message, where: string): Line {
  const base = { id: m.id, at: m.at, nick: m.nick, uid: m.uid };
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
  const leaving = useRef(new Set<string>());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [macros, setMacrosState] = useState<Macro[]>(() => loadMacros(uid));
  const [fill, setFill] = useState<{ text: string; n: number } | null>(null);
  const setMacros = (m: Macro[]) => {
    setMacrosState(m);
    saveMacros(uid, m);
  };
  const clearedAt = useRef<Record<string, number>>({});

  const channels = windows.filter((w): w is Extract<Win, { kind: 'channel' }> => w.kind === 'channel').map((w) => w.chan);
  const activeWin = windows.find((w) => keyOf(w) === active) ?? windows[0];
  // Commands read these through refs, so the lines of a macro each see the result of the last one.
  const live = useRef({ activeWin, channels });
  live.current = { activeWin, channels };

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

  // Reopen the member's channels: they stay in them until they /part, even with the site closed
  // (once, even where React runs effects twice in development). First visit: #institute.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    echo('status', `*** Welcome to InstituteIRC, ${nick}. Type /help for commands.`);
    echo('status', `*** ${t('chatNotEncrypted')}`);
    (async () => {
      let mine: string[] = [];
      try {
        mine = await myChannels(uid);
      } catch {
        // Fall back to the default channel below.
      }
      if (mine.length === 0) {
        try {
          await join(uid, nickRef.current, DEFAULT_CHANNEL);
          mine = [DEFAULT_CHANNEL];
        } catch (e) {
          echo('status', `*** Cannot join #${DEFAULT_CHANNEL}${e instanceof Banned ? ' (banned)' : ''}`, 'error');
        }
      }
      mine.forEach((chan, i) => openWindow({ kind: 'channel', chan }, i === 0));
    })();
  }, []);

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
    const { activeWin, channels } = live.current;
    const nick = nickRef.current;
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
        COMMANDS.forEach((c) => echo(where, `${c.syntax} — ${t(c.key)}`));
        echo(where, t('help_more'));
        return;
      case 'join':
      case 'j': {
        const c = chanName(args[0] ?? '');
        if (!c) throw new Error('Usage: /join #channel (letters, digits, - and _)');
        if (channels.includes(c)) {
          live.current = { ...live.current, activeWin: { kind: 'channel', chan: c } };
          return setActive(`#${c}`);
        }
        try {
          await join(uid, nick, c);
        } catch (e) {
          throw new Error(e instanceof Banned ? `Cannot join #${c} (you are banned)` : `Cannot join #${c}`);
        }
        openWindow({ kind: 'channel', chan: c });
        // The next line of a macro acts in the new window, before the page has re-rendered.
        live.current = { activeWin: { kind: 'channel', chan: c }, channels: [...channels, c] };
        return;
      }
      case 'part':
      case 'leave': {
        const named = args[0]?.startsWith('#') ? chanName(args[0]) : null;
        const c = named ?? needChan();
        leaving.current.add(c);
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
        live.current = { ...live.current, activeWin: { kind: 'pm', uid: other, nick: shownNick } };
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
          leaving.current.add(activeWin.chan);
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

  /** The popup for a nick: talk privately, whois, and for ops the channel actions. */
  const nickMenu: OnNickMenu = (e, target) => {
    e.preventDefault();
    const items: MenuItem[] = [];
    const isMe = target.uid === uid;
    if (!isMe) items.push({ label: t('menuQuery'), run: () => openWindow({ kind: 'pm', uid: target.uid, nick: target.nick }) });
    items.push({ label: t('menuWhois'), run: () => submit(`/whois ${target.nick}`) });
    const c = target.channel;
    if (c?.iAmOp && !isMe) {
      items.push('separator');
      items.push({ label: c.op ? t('menuDeop') : t('menuOp'), run: () => submit(`/${c.op ? 'deop' : 'op'} ${target.nick}`) });
      items.push({ label: c.voice ? t('menuDevoice') : t('menuVoice'), run: () => submit(`/${c.voice ? 'devoice' : 'voice'} ${target.nick}`) });
      items.push('separator');
      items.push({ label: t('menuKick'), run: () => submit(`/kick ${target.nick}`), danger: true });
      items.push({ label: t('menuBan'), run: () => submit(`/ban ${target.nick}`), danger: true });
    }
    setMenu({ x: e.clientX, y: e.clientY, title: target.nick, items });
  };

  /** The popup for a window button: leave a channel, close a private window. */
  const windowMenu = (e: React.MouseEvent, w: Win) => {
    e.preventDefault();
    if (w.kind === 'status') return;
    const items: MenuItem[] =
      w.kind === 'channel'
        ? [
            { label: t('menuList'), run: () => submit('/list') },
            'separator',
            { label: `${t('menuLeave')} #${w.chan}`, run: () => submit(`/part #${w.chan}`), danger: true },
          ]
        : [
            { label: t('menuWhois'), run: () => submit(`/whois ${w.nick}`) },
            { label: t('menuClose'), run: () => closeWindow(keyOf(w)) },
          ];
    setMenu({ x: e.clientX, y: e.clientY, title: titleOf(w), items });
  };

  /** A macro either fills the input line (text ending in a space or "#") or runs line by line. */
  const runMacro = async (m: Macro) => {
    if (fillsInput(m)) return setFill({ text: m.text, n: Date.now() });
    for (const line of m.text.split('\n').filter((l) => l.trim())) await submit(line);
  };

  return (
    // IRC reads left to right even in Hebrew; each message lays out its own text (<bdi>).
    <main className="irc" dir="ltr">
      <div className="irc-titlebar">
        <span>InstituteIRC — {nick}{away ? ' (away)' : ''}</span>
      </div>
      <MacroBar macros={macros} onChange={setMacros} onRun={runMacro} helpOpen={helpOpen} onHelp={() => setHelpOpen(!helpOpen)} />
      <div className="irc-body">
        {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
        <nav className="irc-switchbar" aria-label="Windows">
          {windows.map((w) => {
            const k = keyOf(w);
            return (
              <button key={k} type="button" className={`${k === active ? 'active' : ''} ${unread[k] ? 'unread' : ''}`} onClick={() => setActive(k)} onContextMenu={(e) => windowMenu(e, w)}>
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
          if (w.kind === 'pm') return <PrivateWindow key={k} {...props} me={uid} other={w.uid} nick={w.nick} onNickMenu={nickMenu} />;
          return (
            <ChannelWindow
              key={k}
              {...props}
              chan={w.chan}
              me={uid}
              presence={presence}
              onTopic={(text) => (topics.current[w.chan] = text)}
              onKicked={() => {
                // Leaving on purpose also removes you; only a removal you didn't ask for is a kick.
                if (leaving.current.delete(w.chan)) return;
                closeWindow(k);
                echo('status', `*** You were kicked from #${w.chan}`, 'error');
              }}
              onQuery={(other, n) => openWindow({ kind: 'pm', uid: other, nick: n })}
              onNickMenu={nickMenu}
            />
          );
        })}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <InputLine onSubmit={submit} fill={fill} placeholder={activeWin.kind === 'status' ? '/join #institute' : `${titleOf(activeWin)}…`} />
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

function Lines({ lines, hidden, onNick }: { lines: Line[]; hidden: boolean; onNick?: (e: React.MouseEvent, uid: string, nick: string) => void }) {
  const menuFor = (l: Line) =>
    onNick && l.uid && l.nick ? { onContextMenu: (e: React.MouseEvent) => onNick(e, l.uid!, l.nick!), className: 'irc-nick clickable' } : { className: 'irc-nick' };
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
              <span {...menuFor(l)}>&lt;{l.nick}&gt;</span>{' '}
              <bdi>
                <Formatted text={l.text} />
              </bdi>
            </>
          ) : l.kind === 'action' ? (
            <>
              * <span {...menuFor(l)}>{l.nick}</span>{' '}
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

function PrivateWindow({
  hidden,
  local,
  clearedAt,
  onNew,
  me,
  other,
  nick,
  onNickMenu,
}: WindowProps & { me: string; other: string; nick: string; onNickMenu: OnNickMenu }) {
  const lines = useLog(`pm/${pairId(me, other)}`, nick, onNew);
  return (
    <section className="irc-window" hidden={hidden}>
      <div className="irc-topic">
        {nick} — <a href={hrefOf({ page: 'member', uid: other })}>page</a>
      </div>
      <div className="irc-main">
        <Lines lines={merge(lines, local, clearedAt)} hidden={hidden} onNick={(e, u, n) => onNickMenu(e, { uid: u, nick: n })} />
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
  onNickMenu,
}: WindowProps & {
  chan: string;
  me: string;
  presence: Record<string, { nick: string; away?: string }>;
  onTopic: (t: string) => void;
  onKicked: () => void;
  onQuery: (uid: string, nick: string) => void;
  onNickMenu: OnNickMenu;
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
      .map(([u, p]) => ({ uid: u, nick: p.nick, rank: rank(u), away: presence[u]?.away, online: u in presence }))
      .sort((a, b) => a.rank - b.rank || a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' }));
  }, [people, meta, presence]);

  const standing = (u: string, n: string): NickTarget => ({
    uid: u,
    nick: n,
    channel: { iAmOp: Boolean(meta?.ops[me]), op: Boolean(meta?.ops[u]), voice: Boolean(meta?.voice[u]) },
  });

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
        <Lines lines={merge(lines, local, clearedAt)} hidden={hidden} onNick={(e, u, n) => onNickMenu(e, standing(u, n))} />
        <ul className="irc-nicklist" aria-label="Nicks">
          {nicks.map((n) => (
            <li
              key={n.uid}
              className={!n.online ? 'offline' : n.away ? 'away' : ''}
              title={!n.online ? 'offline' : n.away ? `away: ${n.away}` : undefined}
            >
              <button type="button" onDoubleClick={() => n.uid !== me && onQuery(n.uid, n.nick)} onContextMenu={(e) => onNickMenu(e, standing(n.uid, n.nick))}>
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

function InputLine({ onSubmit, placeholder, fill }: { onSubmit: (s: string) => void; placeholder: string; fill: { text: string; n: number } | null }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const [palette, setPalette] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // A macro put some text in: show it with the cursor at the end, ready to finish.
  useEffect(() => {
    if (!fill) return;
    setText(fill.text);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(fill.text.length, fill.text.length);
    });
  }, [fill?.n]);

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
