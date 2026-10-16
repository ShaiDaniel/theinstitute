// Home page metrics, computed hourly by scripts/compute-stats.mjs: stats/public for visitors (item
// metrics from public lists), stats/members for members (public and members-only lists). Totals in
// both count every list, private ones included, as numbers only.
import { doc, getDoc, type Timestamp } from 'firebase/firestore/lite';
import { db } from './firebase';
import type { Tag } from './entries';
import type { Kind } from './music';

export interface StatItem {
  itemId: string;
  kind: Kind;
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  /** How many lists it is in. */
  lists: number;
  /** How many members ranked it. */
  members: number;
  /** Mean of each member's own average score. */
  average: number;
  /** Lowest and highest member average, and their standard deviation (for "most divisive"). */
  low?: number;
  high?: number;
  spread?: number;
}

/** One line of the home feed: a member added something to a shared list. */
export interface Recent {
  uid: string;
  member: string;
  photo: string | null;
  listId: string;
  listName: string;
  kind: Kind;
  itemId: string;
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  score: number;
  tags: Tag[];
  at: Date;
}

export interface Stats {
  computedAt: Date | null;
  minMembers: number;
  totals: {
    members: number;
    lists: Record<Kind, number>;
    entries: Record<Kind, number>;
    distinct: Record<Kind, number>;
  };
  mostRanked: Record<Kind, StatItem[]>;
  topScored: Record<Kind, StatItem[]>;
  divisive?: Record<Kind, StatItem[]>;
  tags: { tag: Tag; count: number }[];
  decades: { decade: number; count: number }[];
  recent: Recent[];
}

export async function loadStats(viewerIsMember: boolean): Promise<Stats | null> {
  const snap = await getDoc(doc(db, 'stats', viewerIsMember ? 'members' : 'public'));
  if (!snap.exists()) return null;
  const x = snap.data();
  return {
    ...(x as Stats),
    computedAt: (x.computedAt as Timestamp | undefined)?.toDate() ?? null,
    recent: ((x.recent ?? []) as (Omit<Recent, 'at'> & { at: Timestamp })[]).map((r) => ({ ...r, at: r.at.toDate() })),
  };
}
