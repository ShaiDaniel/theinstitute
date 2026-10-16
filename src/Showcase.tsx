// A member's showcase: their named lists of albums, bands, songs and concerts,
// and each list's page. The owner creates lists, chooses who sees each one, searches to add,
// drags to rank, and gives every entry a score, tags and a note.
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import { useSession } from './auth';
import {
  addEntry,
  createList,
  deleteList,
  LIST_NAME_MAX,
  LIST_VISIBILITIES,
  loadEntries,
  loadList,
  loadLists,
  movePosition,
  NOTE_MAX,
  removeEntry,
  renameList,
  SCORES,
  setListVisibility,
  tagsFor,
  updateVerdict,
  type Entry,
  type List,
  type ListVisibility,
  type Tag,
  type Verdict,
  type Viewer,
} from './entries';
import { useI18n, type StringKey } from './i18n';
import { loadMember, type Member } from './members';
import { concertDateOf, concertId, concertItemId, createConcert, formatDate, loadConcert, PLACE_MAX, type Concert, type ConcertPlace } from './concerts';
import { KINDS, resolve, search, type Found, type Item, type Kind } from './music';
import { ListTools } from './ListTools';
import { hrefOf } from './route';
import { TasteMatch } from './TasteMatch';

type ListKind = Kind;
const LIST_KINDS: ListKind[] = KINDS;
const ADD: Record<Kind, StringKey> = { album: 'addAlbum', band: 'addBand', song: 'addSong', concert: 'addConcert' };
const SEARCH: Record<Kind, StringKey> = { album: 'searchAlbum', band: 'searchBand', song: 'searchSong', concert: 'searchConcert' };

class AlreadyInList extends Error {}

export const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Places a new item by score: after everything scored the same or higher. */
function positionFor(list: { score: number; position: number }[], score: number) {
  const at = list.findIndex((e) => e.score < score);
  const before = at === -1 ? list[list.length - 1]?.position : list[at - 1]?.position;
  const after = at === -1 ? undefined : list[at].position;
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export function Picture({ src, kind, size = 56 }: { src: string | null; kind: ListKind; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img className={`pic ${kind}`} src={src} alt="" width={size} height={size} onError={() => setBroken(true)} />
  ) : (
    <span className={`pic ${kind} empty`} style={{ width: size, height: size }} aria-hidden>
      ♪
    </span>
  );
}

export function TagChips({ tags }: { tags: Tag[] }) {
  const { t } = useI18n();
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="chip">
          {t(`tag_${tag}`)}
        </span>
      ))}
    </>
  );
}

function VisibilityBadge({ v }: { v: ListVisibility }) {
  const { t } = useI18n();
  return <span className={`badge vis-${v}`}>{t(`vis_${v}`)}</span>;
}

/** Loads a member and works out how the signed-in viewer relates to them. */
function useOwner(uid: string) {
  const { ready, user, member: me } = useSession();
  const [owner, setOwner] = useState<Member | null | 'membersOnly' | 'missing' | 'error'>(null);
  const viewer: Viewer = user?.uid === uid && me ? 'owner' : me ? 'member' : 'visitor';
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setOwner(null);
    loadMember(uid)
      .then((m) => live && setOwner(m ?? 'missing'))
      .catch((e) => live && setOwner((e as { code?: string }).code === 'permission-denied' ? 'membersOnly' : 'error'));
    return () => {
      live = false;
    };
  }, [uid, ready, me]);
  return { owner, viewer, ready };
}

function OwnerStatus({ owner }: { owner: ReturnType<typeof useOwner>['owner'] }) {
  const { t } = useI18n();
  const key: StringKey = owner === 'missing' ? 'notFound' : owner === 'membersOnly' ? 'membersOnlyPage' : owner === 'error' ? 'loadError' : 'loading';
  return <main className="placeholder">{t(key)}</main>;
}

// --- A member's lists ---------------------------------------------------------------------

interface ListSummary extends List {
  count: number;
  covers: (string | null)[];
}

export function ShowcasePage({ uid }: { uid: string }) {
  const { t } = useI18n();
  const { owner, viewer } = useOwner(uid);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [kind, setKind] = useState<ListKind>('album');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof owner !== 'object' || !owner) return;
    let live = true;
    (async () => {
      try {
        const found = await loadLists(uid, viewer);
        const withEntries = await Promise.all(
          found.map(async (l) => {
            const e = await loadEntries(uid, l.id, viewer);
            return { ...l, count: e.length, covers: e.slice(0, 4).map((x) => x.image) };
          }),
        );
        if (live) setLists(withEntries);
      } catch {
        if (live) setError(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [owner, uid, viewer]);

  if (error) return <main className="placeholder">{t('loadError')}</main>;
  if (typeof owner !== 'object' || !owner) return <OwnerStatus owner={owner} />;
  if (!lists) return <main className="placeholder">{t('loading')}</main>;

  const ofKind = lists.filter((l) => l.kind === kind);
  const isOwn = viewer === 'owner';

  return (
    <main className="showcase">
      <OwnerHeader owner={owner} isOwn={isOwn} />
      {viewer === 'member' && <TasteMatch uid={uid} />}

      <nav className="segmented kinds">
        {LIST_KINDS.map((k) => (
          <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {t(k)}
            <span className="count">{lists.filter((l) => l.kind === k).length}</span>
          </button>
        ))}
      </nav>

      <>
          {isOwn && <NewList uid={uid} kind={kind} position={lists.length ? Math.max(...lists.map((l) => l.position)) + 1 : 1} />}
          {ofKind.length === 0 ? (
            <p className="placeholder">{t(isOwn ? 'noListsOwn' : 'noListsOther')}</p>
          ) : (
            <ul className="lists">
              {ofKind.map((l) => (
                <li key={l.id}>
                  <a href={hrefOf({ page: 'list', uid, listId: l.id })}>
                    <span className="covers">
                      {[0, 1, 2, 3].map((i) => (
                        <Picture key={i} src={l.covers[i] ?? null} kind={l.kind} size={44} />
                      ))}
                    </span>
                    <span className="list-name">{l.name}</span>
                    <span className="muted small">
                      {l.count} {t(l.count === 1 ? 'oneItem' : 'itemsCount')}
                    </span>
                    {isOwn && <VisibilityBadge v={l.visibility} />}
                  </a>
                </li>
              ))}
            </ul>
          )}
      </>
    </main>
  );
}

function OwnerHeader({ owner, isOwn }: { owner: Member; isOwn: boolean }) {
  const { t } = useI18n();
  return (
    <header className="owner">
      {owner.photo && <img src={owner.photo} alt="" referrerPolicy="no-referrer" />}
      <h2>
        <a href={hrefOf({ page: 'member', uid: owner.uid })}>{owner.name}</a>
      </h2>
      {isOwn && (
        <a className="btn" href={hrefOf('me')}>
          {t('editProfile')}
        </a>
      )}
    </header>
  );
}

function NewList({ uid, kind, position }: { uid: string; kind: Kind; position: number }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const create = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const id = await createList(uid, kind, name, position);
      location.hash = hrefOf({ page: 'list', uid, listId: id });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <form
      className="panel new-list"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create();
      }}
    >
      <label className="field">
        <span>{t('newList')}</span>
        <input value={name} maxLength={LIST_NAME_MAX} placeholder={t('listNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
        {t('createList')}
      </button>
      {failed && <span className="error">{t('saveError')}</span>}
    </form>
  );
}

// --- One list -----------------------------------------------------------------------------

export function ListPage({ uid, listId }: { uid: string; listId: string }) {
  const { t } = useI18n();
  const { owner, viewer } = useOwner(uid);
  const [list, setList] = useState<List | null | 'missing'>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof owner !== 'object' || !owner) return;
    let live = true;
    (async () => {
      try {
        const l = await loadList(uid, listId);
        if (!live) return;
        if (!l) return setList('missing');
        setList(l);
        const e = await loadEntries(uid, listId, viewer);
        if (live) setEntries(e);
      } catch (e) {
        if (!live) return;
        if ((e as { code?: string }).code === 'permission-denied') setList('missing');
        else setError(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [owner, uid, listId, viewer]);

  if (error) return <main className="placeholder">{t('loadError')}</main>;
  if (typeof owner !== 'object' || !owner) return <OwnerStatus owner={owner} />;
  if (list === 'missing') return <main className="placeholder">{t('notFound')}</main>;
  if (!list || !entries) return <main className="placeholder">{t('loading')}</main>;

  const isOwn = viewer === 'owner';
  return (
    <main className="showcase">
      <OwnerHeader owner={owner} isOwn={false} />
      {isOwn ? (
        <ListSettings list={list} onChange={setList} />
      ) : (
        <h3 className="list-title">
          {list.name} <span className="muted small">· {t(list.kind)}</span>
        </h3>
      )}
      <ListTools list={list} entries={entries} owner={owner.name} isOwn={isOwn} />
      {isOwn ? (
        <OwnList list={list} entries={entries} setEntries={setEntries} />
      ) : entries.length === 0 ? (
        <p className="placeholder">{t('emptyOther')}</p>
      ) : (
        <ol className="entries">
          {entries.map((e, i) => (
            <li key={e.itemId}>
              <EntryView entry={e} rank={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function ListSettings({ list, onChange }: { list: List; onChange: (l: List) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(list.name);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (job: () => Promise<void>, next: List) => {
    setBusy(true);
    setFailed(false);
    try {
      await job();
      onChange(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(t('deleteListConfirm'))) return;
    setBusy(true);
    try {
      await deleteList(list.uid, list.id);
      location.hash = hrefOf({ page: 'member', uid: list.uid });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <div className="panel list-settings">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== list.name) run(() => renameList(list.uid, list.id, name), { ...list, name: name.trim() });
        }}
      >
        <input className="list-name-input" value={name} maxLength={LIST_NAME_MAX} aria-label={t('rename')} onChange={(e) => setName(e.target.value)} />
        <span className="muted small">{t(list.kind)}</span>
        {name.trim() !== list.name && (
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {t('rename')}
          </button>
        )}
      </form>
      <div className="row">
        <span className="muted small">{t('whoSeesList')}</span>
        <nav className="segmented" aria-label={t('whoSeesList')}>
          {LIST_VISIBILITIES.map((v) => (
            <button
              key={v}
              type="button"
              disabled={busy}
              className={list.visibility === v ? 'active' : ''}
              onClick={() => v !== list.visibility && run(() => setListVisibility(list.uid, list.id, v), { ...list, visibility: v })}
            >
              {t(`vis_${v}`)}
            </button>
          ))}
        </nav>
        <button type="button" className="link danger push" disabled={busy} onClick={remove}>
          {t('deleteList')}
        </button>
      </div>
      {failed && <p className="error">{t('saveError')}</p>}
    </div>
  );
}

/** "Band · year" for albums and songs; "Venue, City · 14 Jun 2005" for concerts. */
export function useSubtitle() {
  const { lang } = useI18n();
  return (e: { itemId: string; artist: string; year: number | null }) => {
    const date = concertDateOf(e.itemId);
    return [e.artist, date ? formatDate(date, lang) : e.year].filter(Boolean).join(' · ');
  };
}

function EntryView({ entry, rank, handle, actions }: { entry: Entry; rank: number; handle?: React.ReactNode; actions?: React.ReactNode }) {
  const subtitle = useSubtitle();
  return (
    <div className="entry">
      {handle}
      <span className="rank">{rank}</span>
      <Picture src={entry.image} kind={entry.kind} />
      <div className="entry-main">
        <a className="title" href={hrefOf({ page: 'item', itemId: entry.itemId })}>
          {entry.title}
        </a>
        <div className="muted small">{subtitle(entry)}</div>
        {entry.tags.length > 0 && (
          <div className="chips">
            <TagChips tags={entry.tags} />
          </div>
        )}
        {entry.note && <p className="note">{entry.note}</p>}
      </div>
      <span className="score">{fmtScore(entry.score)}</span>
      {actions}
    </div>
  );
}

function OwnList({ list, entries, setEntries }: { list: List; entries: Entry[]; setEntries: (e: Entry[]) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const attempt = async (job: () => Promise<void>, rollback: Entry[]) => {
    setFailed(false);
    try {
      await job();
    } catch {
      setEntries(rollback);
      setFailed(true);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = entries.findIndex((e) => e.itemId === active.id);
    const to = entries.findIndex((e) => e.itemId === over.id);
    const moved = arrayMove(entries, from, to);
    const before = moved[to - 1]?.position;
    const after = moved[to + 1]?.position;
    const position = before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2;
    moved[to] = { ...moved[to], position };
    const snapshot = entries;
    setEntries(moved);
    attempt(() => movePosition(moved[to], position), snapshot);
  };

  const add = async (found: Found, v: Verdict, when?: ConcertWhen) => {
    const item = found.kind === 'concert' && when ? await concertEntry(list.uid, found, when) : await resolve(found);
    if (entries.some((e) => e.itemId === item.itemId)) throw new AlreadyInList();
    const position = positionFor(entries, v.score);
    await addEntry(list, item, position, v);
    const entry: Entry = { ...item, ...v, note: v.note.trim(), uid: list.uid, listId: list.id, position };
    setEntries([...entries, entry].sort((a, b) => a.position - b.position));
  };

  const save = (e: Entry, v: Verdict) => {
    const snapshot = entries;
    setEntries(entries.map((x) => (x.itemId === e.itemId ? { ...x, ...v, note: v.note.trim() } : x)));
    setEditing(null);
    attempt(() => updateVerdict(e, v), snapshot);
  };

  const remove = (e: Entry) => {
    if (!confirm(t('removeConfirm'))) return;
    const snapshot = entries;
    setEntries(entries.filter((x) => x.itemId !== e.itemId));
    attempt(() => removeEntry(e), snapshot);
  };

  return (
    <>
      <AddBox kind={list.kind} inList={new Set(entries.map((e) => e.itemId))} onAdd={add} />
      {failed && <p className="error">{t('saveError')}</p>}
      {entries.length === 0 ? (
        <p className="placeholder">{t('emptyOwn')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={entries.map((e) => e.itemId)} strategy={verticalListSortingStrategy}>
            <ol className="entries">
              {entries.map((e, i) => (
                <SortableEntry key={e.itemId} id={e.itemId}>
                  {(handle) =>
                    editing === e.itemId ? (
                      <div className="entry editing">
                        <span className="rank">{i + 1}</span>
                        <Picture src={e.image} kind={e.kind} />
                        <div className="entry-main">
                          <strong>{e.title}</strong>
                          <VerdictForm kind={list.kind} initial={e} submitLabel={t('save')} onSubmit={(v) => save(e, v)} onCancel={() => setEditing(null)} />
                        </div>
                      </div>
                    ) : (
                      <EntryView
                        entry={e}
                        rank={i + 1}
                        handle={handle}
                        actions={
                          <span className="entry-actions">
                            <button type="button" className="link" onClick={() => setEditing(e.itemId)}>
                              {t('edit')}
                            </button>
                            <button type="button" className="link danger" onClick={() => remove(e)}>
                              {t('remove')}
                            </button>
                          </span>
                        }
                      />
                    )
                  }
                </SortableEntry>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}

function SortableEntry({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'dragging' : ''}>
      {children(
        <button type="button" className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('dragToRank')} title={t('dragToRank')}>
          ⋮⋮
        </button>,
      )}
    </li>
  );
}

// --- Search and add ---------------------------------------------------------------------

/** A concert being added: the date, and where it was if no member has added it yet. */
interface ConcertWhen {
  date: string;
  place: ConcertPlace;
}

/** Finds or creates the shared concert, and returns the item for the member's list. */
async function concertEntry(uid: string, band: Found, when: ConcertWhen): Promise<Item> {
  const id = concertId(band.dz, when.date);
  let concert = await loadConcert(id);
  if (!concert) {
    await createConcert(uid, { dz: band.dz, name: band.title, image: band.image }, when.date, when.place);
    concert = await loadConcert(id);
  }
  const c = concert!;
  return {
    kind: 'concert',
    itemId: concertItemId(id),
    title: c.band,
    artist: [c.venue, c.city].filter(Boolean).join(', '),
    year: Number(c.date.slice(0, 4)),
    image: c.image,
    ref: id,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Date and place for a concert; tells the member when the show is already on the site. */
function ConcertFields({ band, onChange }: { band: Found; onChange: (w: ConcertWhen | null) => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState('');
  const [existing, setExisting] = useState<Concert | null | 'loading'>(null);
  const [place, setPlace] = useState<ConcertPlace>({ venue: '', city: '', country: '' });
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today() && date >= '1950-01-01';

  useEffect(() => {
    if (!validDate) {
      setExisting(null);
      return;
    }
    let live = true;
    setExisting('loading');
    loadConcert(concertId(band.dz, date))
      .then((c) => live && setExisting(c))
      .catch(() => live && setExisting(null));
    return () => {
      live = false;
    };
  }, [band.dz, date, validDate]);

  useEffect(() => {
    if (!validDate || existing === 'loading') onChange(null);
    else if (existing) onChange({ date, place: existing });
    else onChange(place.venue.trim() ? { date, place } : null);
  }, [date, validDate, existing, place]);

  const field = (key: keyof ConcertPlace, label: StringKey, required = false) => (
    <label className="field">
      <span>
        {t(label)}
        {required && ' *'}
      </span>
      <input value={place[key]} maxLength={PLACE_MAX} onChange={(e) => setPlace({ ...place, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="concert-fields">
      <label className="field inline">
        <span>{t('concertDate')} *</span>
        <input type="date" value={date} min="1950-01-01" max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {existing && existing !== 'loading' ? (
        <p className="notice-inline">
          {t('concertExists')} <strong>{[existing.venue, existing.city, existing.country].filter(Boolean).join(', ')}</strong>
        </p>
      ) : (
        validDate &&
        existing === null && (
          <div className="place">
            {field('venue', 'venue', true)}
            {field('city', 'city')}
            {field('country', 'country')}
          </div>
        )
      )}
    </div>
  );
}

function AddBox({ kind, inList, onAdd }: { kind: Kind; inList: Set<string>; onAdd: (f: Found, v: Verdict, when?: ConcertWhen) => Promise<void> }) {
  const { t } = useI18n();
  const [when, setWhen] = useState<ConcertWhen | null>(null);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<Found[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [picked, setPicked] = useState<Found | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<StringKey | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      setState('idle');
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setState('searching');
      try {
        const r = await search(kind, query);
        if (n === seq.current) {
          setResults(r);
          setState('idle');
        }
      } catch {
        if (n === seq.current) setState('error');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, kind]);

  const submit = async (v: Verdict) => {
    if (!picked) return;
    setSaving(true);
    setFailed(null);
    try {
      await onAdd(picked, v, when ?? undefined);
      setPicked(null);
      setQ('');
    } catch (e) {
      setFailed(e instanceof AlreadyInList ? 'alreadyInList' : 'saveError');
    } finally {
      setSaving(false);
    }
  };

  if (picked) {
    return (
      <div className="panel add">
        <div className="entry">
          <Picture src={picked.image} kind={kind} />
          <div className="entry-main">
            <strong>{picked.title}</strong>
            <div className="muted small">{picked.artist}</div>
            {kind === 'concert' && <ConcertFields band={picked} onChange={setWhen} />}
            <VerdictForm
              kind={kind}
              submitLabel={t('add')}
              busy={saving}
              blocked={kind === 'concert' && !when}
              onSubmit={submit}
              onCancel={() => setPicked(null)}
            />
            {failed && <p className="error">{t(failed)}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel add">
      <label className="field">
        <span>{t(ADD[kind])}</span>
        <input type="search" value={q} placeholder={t(SEARCH[kind])} onChange={(e) => setQ(e.target.value)} />
      </label>
      {state === 'searching' && <p className="muted small">{t('searching')}</p>}
      {state === 'error' && <p className="error small">{t('searchError')}</p>}
      {results && state === 'idle' && results.length === 0 && <p className="muted small">{t('noResults')}</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((f) => {
            const already = inList.has(f.key);
            return (
              <li key={f.key}>
                <button type="button" disabled={already} onClick={() => setPicked(f)}>
                  <Picture src={f.thumb} kind={kind} size={40} />
                  <span className="entry-main">
                    <span>{f.title}</span>
                    {f.artist && <span className="muted small">{f.artist}</span>}
                  </span>
                  {already && <span className="muted small">{t('inList')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Score, tags and note ---------------------------------------------------------------

function VerdictForm({
  kind,
  initial,
  submitLabel,
  busy,
  blocked,
  onSubmit,
  onCancel,
}: {
  kind: ListKind;
  initial?: Verdict;
  submitLabel: string;
  busy?: boolean;
  /** Keeps the submit button off until something else in the form is filled in. */
  blocked?: boolean;
  onSubmit: (v: Verdict) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [score, setScore] = useState<number | null>(initial?.score ?? null);
  const [tags, setTags] = useState<Tag[]>(initial?.tags ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const toggle = (tag: Tag) => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]));

  return (
    <div className="verdict">
      <label className="field inline">
        <span>{t('score')}</span>
        <select value={score ?? ''} onChange={(e) => setScore(e.target.value ? Number(e.target.value) : null)}>
          <option value="">—</option>
          {[...SCORES].reverse().map((s) => (
            <option key={s} value={s}>
              {fmtScore(s)}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>{t('tags')}</span>
        <div className="chips">
          {tagsFor(kind).map((tag) => (
            <button key={tag} type="button" className={`chip toggle ${tags.includes(tag) ? 'on' : ''}`} aria-pressed={tags.includes(tag)} onClick={() => toggle(tag)}>
              {t(`tag_${tag}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>{t('note')}</span>
        <textarea rows={2} maxLength={NOTE_MAX} value={note} placeholder={t('notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || blocked || score === null} onClick={() => score !== null && onSubmit({ score, tags, note })}>
          {submitLabel}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
