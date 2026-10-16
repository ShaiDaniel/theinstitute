// mIRC text formatting: Ctrl+K colours (\x03 fg[,bg]), Ctrl+B bold (\x02), Ctrl+U underline (\x1F),
// Ctrl+I italic (\x1D), Ctrl+O reset (\x0F), Ctrl+R reverse (\x16). Rendered as spans; the text
// itself is never interpreted as HTML.
import type { CSSProperties, ReactNode } from 'react';

export const COLOR = '\x03';
export const BOLD = '\x02';
export const UNDERLINE = '\x1F';
export const ITALIC = '\x1D';
export const RESET = '\x0F';
const REVERSE = '\x16';

/** The 16 mIRC colours, in mIRC's own order. */
export const PALETTE = [
  '#ffffff', '#000000', '#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00',
  '#ffff00', '#00fc00', '#009393', '#00ffff', '#0000fc', '#ff00ff', '#7f7f7f', '#d2d2d2',
];
export const COLOR_NAMES = [
  'white', 'black', 'navy', 'green', 'red', 'maroon', 'purple', 'orange',
  'yellow', 'lime', 'teal', 'cyan', 'blue', 'pink', 'grey', 'silver',
];

interface Style {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  underline: boolean;
  italic: boolean;
}
const plain = (): Style => ({ fg: null, bg: null, bold: false, underline: false, italic: false });

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Plain text with links made clickable (only http and https). */
function linkify(text: string, key: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={`${key}-${i}`} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export function Formatted({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let style = plain();
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const css: CSSProperties = {};
    if (style.fg !== null) css.color = PALETTE[style.fg];
    if (style.bg !== null) css.backgroundColor = PALETTE[style.bg];
    if (style.bold) css.fontWeight = 700;
    if (style.underline) css.textDecoration = 'underline';
    if (style.italic) css.fontStyle = 'italic';
    const key = String(out.length);
    out.push(Object.keys(css).length ? <span key={key} style={css}>{linkify(buf, key)}</span> : <span key={key}>{linkify(buf, key)}</span>);
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === BOLD || c === UNDERLINE || c === ITALIC || c === RESET || c === REVERSE) {
      flush();
      if (c === BOLD) style = { ...style, bold: !style.bold };
      else if (c === UNDERLINE) style = { ...style, underline: !style.underline };
      else if (c === ITALIC) style = { ...style, italic: !style.italic };
      else if (c === REVERSE) style = { ...style, fg: style.bg ?? 0, bg: style.fg ?? 1 };
      else style = plain();
    } else if (c === COLOR) {
      flush();
      const m = /^(\d{1,2})(?:,(\d{1,2}))?/.exec(text.slice(i + 1));
      if (m) {
        style = { ...style, fg: Number(m[1]) % 16, bg: m[2] !== undefined ? Number(m[2]) % 16 : style.bg };
        i += m[0].length;
      } else {
        style = { ...style, fg: null, bg: null };
      }
    } else {
      buf += c;
    }
  }
  flush();
  return <>{out}</>;
}

/** The text without any formatting codes (for previews and lengths). */
export const stripCodes = (text: string) => text.replace(/\x03(\d{1,2}(,\d{1,2})?)?|[\x02\x1F\x1D\x0F\x16]/g, '');
