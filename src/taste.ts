// Taste match between two members: how close their scores are on the things both have rated.
// Each person's score for an item is their average across their lists; the match is 100% when
// every shared item got the same score and 0% when every one is 9 points apart (1 vs 10).
import { loadEntries, loadLists, type Entry, type Viewer } from './entries';

export const MIN_COMMON = 3;

export interface Common {
  itemId: string;
  kind: Entry['kind'];
  title: string;
  artist: string;
  image: string | null;
  mine: number;
  theirs: number;
}

export interface Match {
  percent: number;
  common: Common[];
}

/** Every entry of a member's that the viewer may see, across their lists. */
export async function allEntries(uid: string, viewer: Viewer): Promise<Entry[]> {
  const lists = await loadLists(uid, viewer);
  return (await Promise.all(lists.map((l) => loadEntries(uid, l.id, viewer)))).flat();
}

function averages(entries: Entry[]) {
  const by = new Map<string, { entry: Entry; scores: number[] }>();
  for (const e of entries) {
    const x = by.get(e.itemId) ?? { entry: e, scores: [] };
    x.scores.push(e.score);
    by.set(e.itemId, x);
  }
  return new Map([...by].map(([id, x]) => [id, { entry: x.entry, score: x.scores.reduce((a, b) => a + b, 0) / x.scores.length }]));
}

export function tasteMatch(mine: Entry[], theirs: Entry[]): Match | null {
  const a = averages(mine);
  const b = averages(theirs);
  const common: Common[] = [];
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y) continue;
    common.push({ itemId: id, kind: x.entry.kind, title: x.entry.title, artist: x.entry.artist, image: x.entry.image, mine: x.score, theirs: y.score });
  }
  if (common.length < MIN_COMMON) return common.length ? { percent: NaN, common } : null;
  const gap = common.reduce((s, c) => s + Math.abs(c.mine - c.theirs), 0) / common.length;
  return { percent: Math.round(100 - (gap / 9) * 100), common: common.sort((p, q) => Math.abs(q.mine - q.theirs) - Math.abs(p.mine - p.theirs)) };
}
