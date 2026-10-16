// Export and import of a member's own data, so nobody loses their work:
// - Export: one JSON file with the profile name, every list (name, kind, who sees it, order) with
//   every entry (item, score, tags, note), the facts of the concerts in them, and the chat macros
//   saved in this browser.
// - Import: adds the file's lists as NEW lists (never overwrites or merges into existing ones), all
//   private ("only me") so nothing is shared by surprise; recreates concerts that are missing;
//   adds macros whose labels aren't there yet. Anything malformed is skipped and counted.
import { writeBatch } from 'firebase/firestore/lite';
import { concertIdOf, createConcert, loadConcert, type Concert } from './concerts';
import { createList, entryData, entryDoc, LIST_NAME_MAX, loadEntries, loadLists, NOTE_MAX, TAGS, type List, type ListVisibility, type Tag } from './entries';
import { db } from './firebase';
import { KINDS, type Kind } from './music';
import { loadMacros, saveMacros, type Macro } from './chat/Macros';

export const BACKUP_FORMAT = 'theinstitute-backup';
const BACKUP_VERSION = 1;

interface BackupEntry {
  itemId: string;
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  ref: string;
  score: number;
  tags: Tag[];
  note: string;
}

interface BackupList {
  name: string;
  kind: Kind;
  visibility: ListVisibility;
  entries: BackupEntry[];
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  profile: { name: string };
  lists: BackupList[];
  concerts: Record<string, Omit<Concert, 'id'>>;
  chatMacros?: Macro[];
}

// --- Export -------------------------------------------------------------------------------

export async function buildBackup(uid: string, name: string): Promise<Backup> {
  const lists = await loadLists(uid, 'owner');
  const out: BackupList[] = [];
  const concerts: Backup['concerts'] = {};
  for (const l of lists) {
    const entries = await loadEntries(uid, l.id, 'owner');
    out.push({
      name: l.name,
      kind: l.kind,
      visibility: l.visibility,
      entries: entries.map((e) => ({ itemId: e.itemId, title: e.title, artist: e.artist, year: e.year, image: e.image, ref: e.ref, score: e.score, tags: e.tags, note: e.note })),
    });
    for (const e of entries.filter((x) => x.kind === 'concert')) {
      const id = concertIdOf(e.itemId);
      if (concerts[id]) continue;
      const c = await loadConcert(id).catch(() => null);
      if (c) {
        const { id: _, ...facts } = c;
        concerts[id] = facts;
      }
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: { name },
    lists: out,
    concerts,
    chatMacros: loadMacros(uid),
  };
}

/** Saves the backup as a file named like "the-institute-backup-2026-10-16.json". */
export function downloadBackup(backup: Backup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `the-institute-backup-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- Reading a file -----------------------------------------------------------------------

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const validScore = (x: unknown) => typeof x === 'number' && x >= 1 && x <= 10 && Math.floor(x * 2) === x * 2;

function cleanEntry(kind: Kind, x: unknown): BackupEntry | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, unknown>;
  const itemId = str(e.itemId, 220);
  if (!new RegExp(`^${kind}:[^/]{1,200}$`).test(itemId) || !str(e.title, 300) || !validScore(e.score)) return null;
  return {
    itemId,
    title: str(e.title, 300),
    artist: str(e.artist, 300),
    year: typeof e.year === 'number' && Number.isInteger(e.year) ? e.year : null,
    image: typeof e.image === 'string' && /^https:\/\//.test(e.image) ? e.image.slice(0, 1000) : null,
    ref: str(e.ref, 100),
    score: e.score as number,
    tags: Array.isArray(e.tags) ? (e.tags.filter((t) => (TAGS as readonly string[]).includes(t)) as Tag[]).slice(0, 9) : [],
    note: str(e.note, NOTE_MAX),
  };
}

export interface ReadResult {
  backup: Backup;
  lists: number;
  entries: number;
  skipped: number;
}

/** Checks a file's contents and keeps only what is well formed. Throws when it isn't a backup. */
export function readBackup(text: string): ReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('notBackup');
  }
  const r = raw as Partial<Backup>;
  if (!r || r.format !== BACKUP_FORMAT || !Array.isArray(r.lists)) throw new Error('notBackup');
  let skipped = 0;
  const lists: BackupList[] = [];
  for (const l of r.lists) {
    const kind = l?.kind as Kind;
    if (!KINDS.includes(kind) || !str(l.name, LIST_NAME_MAX).trim()) {
      skipped += Array.isArray(l?.entries) ? l.entries.length : 0;
      continue;
    }
    const entries: BackupEntry[] = [];
    const seen = new Set<string>();
    for (const e of Array.isArray(l.entries) ? l.entries : []) {
      const clean = cleanEntry(kind, e);
      if (!clean || seen.has(clean.itemId)) skipped++;
      else {
        seen.add(clean.itemId);
        entries.push(clean);
      }
    }
    lists.push({ name: str(l.name, LIST_NAME_MAX).trim(), kind, visibility: 'private', entries });
  }
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: Number(r.version) || 1,
    exportedAt: str(r.exportedAt, 40),
    profile: { name: str(r.profile?.name, 60) },
    lists,
    concerts: r.concerts && typeof r.concerts === 'object' ? r.concerts : {},
    chatMacros: Array.isArray(r.chatMacros) ? r.chatMacros : [],
  };
  return { backup, lists: lists.length, entries: lists.reduce((n, l) => n + l.entries.length, 0), skipped };
}

// --- Import -------------------------------------------------------------------------------

export interface ImportResult {
  lists: number;
  entries: number;
  concerts: number;
  macros: number;
}

/** Adds the backup's lists as new private lists (names that already exist get "(imported)"). */
export async function importBackup(uid: string, backup: Backup, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const existing = await loadLists(uid, 'owner');
  const taken = new Set(existing.map((l) => `${l.kind}/${l.name.toLowerCase()}`));
  let position = existing.length ? Math.max(...existing.map((l) => l.position)) + 1 : 1;
  const total = backup.lists.reduce((n, l) => n + l.entries.length, 0);
  const result: ImportResult = { lists: 0, entries: 0, concerts: 0, macros: 0 };

  // Concerts first, so the entries point at real concert pages.
  for (const [id, c] of Object.entries(backup.concerts)) {
    const used = backup.lists.some((l) => l.entries.some((e) => e.itemId === `concert:${id}`));
    if (!used || !c || typeof c !== 'object' || (await loadConcert(id).catch(() => null))) continue;
    try {
      await createConcert(uid, { dz: Number(c.bandDz), name: str(c.band, 300), image: typeof c.image === 'string' ? c.image : null }, str(c.date, 10), {
        venue: str(c.venue, 120) || '?',
        city: str(c.city, 120),
        country: str(c.country, 120),
      });
      result.concerts++;
    } catch {
      // A concert that doesn't fit the rules is skipped; the entries still import.
    }
  }

  for (const l of backup.lists) {
    let name = l.name;
    if (taken.has(`${l.kind}/${name.toLowerCase()}`)) name = `${name} (imported)`.slice(0, LIST_NAME_MAX);
    taken.add(`${l.kind}/${name.toLowerCase()}`);
    const id = await createList(uid, l.kind, name, position++);
    const list: List = { uid, id, kind: l.kind, name, visibility: 'private', position: position - 1 };
    result.lists++;
    // Up to 400 entries per batch (Firestore allows 500 writes).
    for (let i = 0; i < l.entries.length; i += 400) {
      const batch = writeBatch(db);
      l.entries.slice(i, i + 400).forEach((e, j) => {
        batch.set(
          entryDoc(list, e.itemId),
          entryData(list, { kind: l.kind, itemId: e.itemId, title: e.title, artist: e.artist, year: e.year, image: e.image, ref: e.ref }, i + j + 1, {
            score: e.score,
            tags: e.tags,
            note: e.note,
          }),
        );
      });
      await batch.commit();
      result.entries += Math.min(400, l.entries.length - i);
      onProgress?.(result.entries, total);
    }
  }

  // Chat macros: add the ones whose label this browser doesn't have yet.
  const macros = loadMacros(uid);
  const labels = new Set(macros.map((m) => m.label));
  const fresh = (backup.chatMacros ?? []).filter(
    (m) => m && typeof m.label === 'string' && typeof m.text === 'string' && m.label.trim() && !labels.has(m.label),
  );
  if (fresh.length) {
    saveMacros(uid, [...macros, ...fresh.map((m, i) => ({ id: `m-${Date.now()}-${i}`, label: m.label.slice(0, 20), text: m.text.slice(0, 1000) }))]);
    result.macros = fresh.length;
  }
  return result;
}
