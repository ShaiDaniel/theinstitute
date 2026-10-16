// "Your data" on the profile page: download a backup of everything you made, or bring one back.
import { useRef, useState } from 'react';
import { buildBackup, downloadBackup, importBackup, readBackup, type ReadResult } from './backup';
import { useI18n } from './i18n';

export function DataBackup({ uid, name }: { uid: string; name: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<null | 'export' | 'import'>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<ReadResult | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const backup = await buildBackup(uid, name);
      downloadBackup(backup);
      const entries = backup.lists.reduce((n, l) => n + l.entries.length, 0);
      setMessage({ text: t('exportDone').replace('{lists}', String(backup.lists.length)).replace('{entries}', String(entries)) });
    } catch {
      setMessage({ text: t('exportFailed'), error: true });
    } finally {
      setBusy(null);
    }
  };

  const choose = async (f: File | undefined) => {
    setMessage(null);
    setPending(null);
    if (!f) return;
    try {
      setPending(readBackup(await f.text()));
    } catch {
      setMessage({ text: t('importNotBackup'), error: true });
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy('import');
    setMessage(null);
    try {
      const r = await importBackup(uid, pending.backup, (done, total) => setProgress(`${done} / ${total}`));
      setMessage({
        text: t('importDone')
          .replace('{lists}', String(r.lists))
          .replace('{entries}', String(r.entries))
          .replace('{concerts}', String(r.concerts))
          .replace('{macros}', String(r.macros)),
      });
      setPending(null);
    } catch {
      setMessage({ text: t('importFailed'), error: true });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <section className="data-backup">
      <h3>{t('yourData')}</h3>
      <p className="muted small">{t('yourDataHint')}</p>
      <div className="row">
        <button type="button" className="btn" disabled={busy !== null} onClick={doExport}>
          {busy === 'export' ? t('loading') : t('exportData')}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => file.current?.click()}>
          {t('importData')}
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="notice-inline import-preview">
          <p>
            {t('importPreview')
              .replace('{name}', pending.backup.profile.name || '?')
              .replace('{date}', pending.backup.exportedAt.slice(0, 10) || '?')
              .replace('{lists}', String(pending.lists))
              .replace('{entries}', String(pending.entries))}
            {pending.skipped > 0 && ` ${t('importSkipped').replace('{n}', String(pending.skipped))}`}
          </p>
          <p className="muted small">{t('importHow')}</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy !== null || pending.lists === 0} onClick={doImport}>
              {busy === 'import' ? `${t('importing')} ${progress ?? ''}` : t('importConfirm')}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => setPending(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {message && <p className={message.error ? 'error' : 'muted'}>{message.text}</p>}
    </section>
  );
}
