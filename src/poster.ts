// A "top N" poster of a list (3, 5, 7 or 9), drawn on a canvas, like my9albums: the covers in a
// grid with rank and score, the ranked titles underneath, the list and member's names on top.
// Every cover host the site uses allows this (CORS), so the canvas can be saved as a PNG.
import type { Entry } from './entries';

export const POSTER_SIZES = [3, 5, 7, 9] as const;
export type PosterSize = (typeof POSTER_SIZES)[number];

const W = 1080;
const PAD = 60;
const GAP = 16;
const BG = '#0b0b0f';
const PANEL = '#15151c';
const TEXT = '#ecebf2';
const MUTED = '#8f8da3';
const ACCENT = '#e8402c';
const DISPLAY = '"Bebas Neue", Impact, sans-serif';
const BODY = 'Heebo, "Segoe UI", sans-serif';

/** Rows of covers, biggest first: the top ranks get the bigger squares. */
const ROWS: Record<PosterSize, number[]> = { 3: [3], 5: [2, 3], 7: [3, 4], 9: [3, 3, 3] };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Bigger versions of the cover where the host has them (Deezer 500 px). */
const bigger = (url: string) => url.replace(/\/(\d{2,3})x\1-/, '/500x500-');

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = bigger(url);
  });
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

export interface PosterInput {
  entries: Entry[];
  size: PosterSize;
  listName: string;
  owner: string;
  kindLabel: string;
  subtitle: (e: Entry) => string;
  site: string;
}

export async function drawPoster(canvas: HTMLCanvasElement, p: PosterInput) {
  const top = p.entries.slice(0, p.size);
  const rows = ROWS[p.size].reduce<Entry[][]>((acc, n) => {
    const used = acc.flat().length;
    if (used < top.length) acc.push(top.slice(used, used + n));
    return acc;
  }, []);
  await Promise.all([document.fonts.load(`72px ${DISPLAY}`), document.fonts.load(`600 30px ${BODY}`), document.fonts.load(`30px ${BODY}`)]).catch(() => {});
  const images = await Promise.all(top.map((e) => loadImage(e.image)));

  // Sizes: each row's squares fill the width.
  const cell = (n: number) => (W - 2 * PAD - (n - 1) * GAP) / n;
  const gridH = rows.reduce((h, r) => h + cell(ROWS[p.size][rows.indexOf(r)]) + GAP, 0) - GAP;
  const lineH = 46;
  const headerH = 190;
  const footerH = 90;
  const H = Math.round(headerH + gridH + 40 + top.length * lineH + footerH);

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';

  // Header: TOP N · kind, the list's name, whose it is.
  ctx.fillStyle = ACCENT;
  ctx.font = `44px ${DISPLAY}`;
  ctx.fillText(`TOP ${top.length} · ${p.kindLabel.toUpperCase()}`, PAD, 82);
  ctx.fillStyle = TEXT;
  ctx.font = `76px ${DISPLAY}`;
  ctx.fillText(fit(ctx, p.listName.toUpperCase(), W - 2 * PAD), PAD, 150);
  ctx.fillStyle = MUTED;
  ctx.font = `30px ${BODY}`;
  ctx.fillText(fit(ctx, p.owner, W - 2 * PAD), PAD, 186);

  // The covers.
  let y = headerH + 10;
  let rank = 0;
  rows.forEach((row, r) => {
    const size = cell(ROWS[p.size][r]);
    const rowW = row.length * size + (row.length - 1) * GAP;
    let x = (W - rowW) / 2;
    for (const e of row) {
      const img = images[rank];
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, y, size, size);
      if (img) {
        // Cover-fit a non-square picture.
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, size, size);
      } else {
        ctx.fillStyle = MUTED;
        ctx.font = `${Math.round(size / 3)}px ${BODY}`;
        ctx.textAlign = 'center';
        ctx.fillText('♪', x + size / 2, y + size / 2 + size / 9);
        ctx.textAlign = 'start';
      }
      rank++;
      // Rank badge (top-left) and score badge (bottom-right).
      const b = Math.max(48, Math.round(size / 6));
      ctx.fillStyle = ACCENT;
      ctx.fillRect(x, y, b, b);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(b * 0.8)}px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(rank), x + b / 2, y + b * 0.8);
      const score = fmt(e.score);
      ctx.font = `${Math.round(b * 0.62)}px ${DISPLAY}`;
      const sw = Math.max(b, ctx.measureText(score).width + 20);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x + size - sw, y + size - b * 0.8, sw, b * 0.8);
      ctx.fillStyle = '#fff';
      ctx.fillText(score, x + size - sw / 2, y + size - b * 0.18);
      ctx.textAlign = 'start';
      x += size + GAP;
    }
    y += size + GAP;
  });

  // The ranked titles.
  y += 40 - GAP;
  top.forEach((e, i) => {
    const ly = y + i * lineH + 30;
    ctx.fillStyle = ACCENT;
    ctx.font = `36px ${DISPLAY}`;
    ctx.fillText(String(i + 1).padStart(2, ' '), PAD, ly);
    ctx.fillStyle = TEXT;
    ctx.font = `600 28px ${BODY}`;
    const title = fit(ctx, e.title, 560);
    ctx.fillText(title, PAD + 56, ly);
    const tw = ctx.measureText(title).width;
    ctx.fillStyle = MUTED;
    ctx.font = `26px ${BODY}`;
    ctx.fillText(fit(ctx, p.subtitle(e), W - 2 * PAD - 56 - tw - 20), PAD + 56 + tw + 16, ly);
  });

  // Footer.
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, H - footerH + 20, W, footerH - 20);
  ctx.fillStyle = TEXT;
  ctx.font = `40px ${DISPLAY}`;
  ctx.fillText('THE INSTITUTE', PAD, H - 26);
  ctx.fillStyle = MUTED;
  ctx.font = `24px ${BODY}`;
  ctx.textAlign = 'end';
  ctx.fillText(p.site, W - PAD, H - 30);
  ctx.textAlign = 'start';
}

export const posterBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));

/** A file name from the list's name: "All-time albums" → "all-time-albums-top-5.png". */
export const posterFileName = (listName: string, size: number) =>
  `${listName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'list'}-top-${size}.png`;
