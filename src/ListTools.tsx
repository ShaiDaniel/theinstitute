// Tools on a list's page, for anyone who can see it: a share link and a top 3/5/7/9 poster.
import { useEffect, useRef, useState } from 'react';
import type { Entry, List } from './entries';
import { useI18n } from './i18n';
import { drawPoster, POSTER_SIZES, posterBlob, posterFileName, type PosterSize } from './poster';
import { hrefOf } from './route';
import { useSubtitle } from './Showcase';

const listUrl = (list: List) => `${location.origin}${location.pathname}${hrefOf({ page: 'list', uid: list.uid, listId: list.id })}`;

export function ListTools({ list, entries, owner, isOwn }: { list: List; entries: Entry[]; owner: string; isOwn: boolean }) {
  const { t } = useI18n();
  const [poster, setPoster] = useState(false);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const linkBox = useRef<HTMLInputElement>(null);

  const share = async () => {
    const url = listUrl(list);
    const text = `${list.name} — ${owner}`;
    setCopied(null);
    // Phones: the share sheet (WhatsApp and the rest); elsewhere: copy the link.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: text, text, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied('copied');
    } catch {
      // Copying isn't allowed here: show the link, selected, to copy by hand.
      setCopied('failed');
      requestAnimationFrame(() => linkBox.current?.select());
    }
  };

  return (
    <div className="list-tools">
      <button type="button" className="btn" onClick={share}>
        🔗 {t('shareList')}
      </button>
      {entries.length > 0 && (
        <button type="button" className="btn" onClick={() => setPoster(true)}>
          🖼 {t('posterButton')}
        </button>
      )}
      {copied === 'copied' && <span className="muted small">{t('linkCopied')}</span>}
      {copied === 'failed' && (
        <label className="link-box">
          <span className="muted small">{t('shareCopyManually')}</span>
          <input ref={linkBox} readOnly value={listUrl(list)} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
      {isOwn && list.visibility !== 'public' && (
        <span className="muted small">{t(list.visibility === 'private' ? 'shareNotePrivate' : 'shareNoteMembers')}</span>
      )}
      {poster && <PosterDialog list={list} entries={entries} owner={owner} onClose={() => setPoster(false)} />}
    </div>
  );
}

function PosterDialog({ list, entries, owner, onClose }: { list: List; entries: Entry[]; owner: string; onClose: () => void }) {
  const { t } = useI18n();
  const subtitle = useSubtitle();
  const sizes = POSTER_SIZES.filter((n) => n <= Math.max(3, entries.length));
  const [size, setSize] = useState<PosterSize>(sizes.includes(9) ? 9 : sizes[sizes.length - 1]);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    const c = document.createElement('canvas');
    canvas.current = c;
    drawPoster(c, {
      entries,
      size,
      listName: list.name,
      owner,
      kindLabel: t(list.kind),
      subtitle,
      site: `${location.host}${location.pathname}`.replace(/\/$/, ''),
    })
      .then(() => live && setUrl(c.toDataURL('image/png')))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [size]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);

  const file = async () => new File([await posterBlob(canvas.current!)], posterFileName(list.name, size), { type: 'image/png' });

  const download = async () => {
    const f = await file();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const shareImage = async () => {
    const f = await file();
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: list.name }).catch(() => {});
    else download();
  };

  const canShareFiles = typeof navigator.canShare === 'function';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" role="dialog" aria-label={t('posterButton')} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>{t('posterTitle')}</h3>
          <button type="button" className="link push" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        <nav className="segmented" aria-label={t('posterSize')}>
          {POSTER_SIZES.map((n) => (
            <button key={n} type="button" className={size === n ? 'active' : ''} disabled={!sizes.includes(n)} onClick={() => setSize(n)}>
              {t('posterTop')} {n}
            </button>
          ))}
        </nav>
        <div className="poster-preview">
          {failed ? <p className="error">{t('posterFailed')}</p> : url ? <img src={url} alt={t('posterTitle')} /> : <p className="muted">{t('loading')}</p>}
        </div>
        <div className="row">
          <button type="button" className="btn primary" disabled={!url} onClick={download}>
            {t('posterDownload')}
          </button>
          {canShareFiles && (
            <button type="button" className="btn" disabled={!url} onClick={shareImage}>
              {t('posterShare')}
            </button>
          )}
          {entries.length < size && <span className="muted small">{t('posterFewer').replace('{n}', String(entries.length))}</span>}
        </div>
      </div>
    </div>
  );
}
