// Macro buttons, like mIRC's toolbar and aliases. A macro is a label and some text:
// - text ending with a space (e.g. "/msg ") goes into the input line for you to finish;
// - anything else runs at once, one line at a time (several lines = several commands in a row).
// Saved in this browser only (localStorage), starting from a set of presets.
import { useState } from 'react';
import { useI18n } from '../i18n';

export interface Macro {
  id: string;
  label: string;
  text: string;
}

export const PRESETS: Macro[] = [
  { id: 'p-join', label: '/join', text: '/join #' },
  { id: 'p-me', label: '/me', text: '/me ' },
  { id: 'p-msg', label: '/msg', text: '/msg ' },
  { id: 'p-whois', label: '/whois', text: '/whois ' },
  { id: 'p-brb', label: 'brb', text: '/away brb' },
  { id: 'p-back', label: 'back', text: '/away' },
  { id: 'p-list', label: '/list', text: '/list' },
  { id: 'p-clear', label: '/clear', text: '/clear' },
];

export const MACRO_LABEL_MAX = 20;
export const MACRO_TEXT_MAX = 1000;
const MAX_MACROS = 30;

const storageKey = (uid: string) => `chat:${uid}:macros`;

export function loadMacros(uid: string): Macro[] {
  try {
    const x = JSON.parse(localStorage.getItem(storageKey(uid)) ?? 'null');
    if (Array.isArray(x) && x.every((m) => typeof m?.id === 'string' && typeof m.label === 'string' && typeof m.text === 'string')) return x;
  } catch {
    // Not saved, or unreadable: start from the presets.
  }
  return PRESETS;
}

export function saveMacros(uid: string, macros: Macro[]) {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(macros));
  } catch {
    // Not saved; they last until the page closes.
  }
}

/** True when the macro fills the input line instead of running. */
export const fillsInput = (m: Macro) => /\s$/.test(m.text) || m.text.endsWith('#');

export function MacroBar({
  macros,
  onChange,
  onRun,
  helpOpen,
  onHelp,
}: {
  macros: Macro[];
  onChange: (m: Macro[]) => void;
  onRun: (m: Macro) => void;
  helpOpen: boolean;
  onHelp: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Macro | null>(null);

  const save = (m: Macro) => {
    const exists = macros.some((x) => x.id === m.id);
    onChange(exists ? macros.map((x) => (x.id === m.id ? m : x)) : [...macros, m].slice(0, MAX_MACROS));
    setForm(null);
  };
  const remove = (m: Macro) => {
    onChange(macros.filter((x) => x.id !== m.id));
    setForm(null);
  };

  return (
    <div className="irc-toolbar" role="toolbar" aria-label={t('macros')}>
      <button type="button" className={`irc-tool help ${helpOpen ? 'pressed' : ''}`} onClick={onHelp} aria-pressed={helpOpen} title={t('helpTitle')}>
        ? {t('helpButton')}
      </button>
      <span className="irc-sep" aria-hidden />
      {macros.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`irc-tool ${editing ? 'editing' : ''}`}
          title={editing ? t('macroEditOne') : m.text.replace(/\n/g, ' ⏎ ')}
          onClick={() => (editing ? setForm(m) : onRun(m))}
        >
          {editing && '✎ '}
          {m.label}
        </button>
      ))}
      <span className="irc-sep" aria-hidden />
      <button type="button" className="irc-tool" onClick={() => setForm({ id: `m-${Date.now()}`, label: '', text: '' })} disabled={macros.length >= MAX_MACROS}>
        + {t('macroAdd')}
      </button>
      <button type="button" className={`irc-tool ${editing ? 'pressed' : ''}`} onClick={() => setEditing(!editing)} aria-pressed={editing}>
        {t(editing ? 'macroDone' : 'macroEdit')}
      </button>
      {editing && (
        <button type="button" className="irc-tool" onClick={() => onChange(PRESETS)} title={t('macroResetHint')}>
          {t('macroReset')}
        </button>
      )}
      {form && <MacroForm macro={form} isNew={!macros.some((x) => x.id === form.id)} onSave={save} onDelete={remove} onCancel={() => setForm(null)} />}
    </div>
  );
}

function MacroForm({
  macro,
  isNew,
  onSave,
  onDelete,
  onCancel,
}: {
  macro: Macro;
  isNew: boolean;
  onSave: (m: Macro) => void;
  onDelete: (m: Macro) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [label, setLabel] = useState(macro.label);
  const [text, setText] = useState(macro.text);
  const ok = label.trim() && text.trim();
  return (
    <div className="irc-dialog" role="dialog" aria-label={t(isNew ? 'macroAdd' : 'macroEditOne')} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="irc-help-title">
        <span>{t(isNew ? 'macroAdd' : 'macroEditOne')}</span>
        <button type="button" onClick={onCancel} aria-label={t('close')}>
          ✕
        </button>
      </div>
      <div className="irc-dialog-body">
        <label>
          <span>{t('macroLabel')}</span>
          <input value={label} maxLength={MACRO_LABEL_MAX} onChange={(e) => setLabel(e.target.value)} autoFocus dir="auto" />
        </label>
        <label>
          <span>{t('macroText')}</span>
          <textarea rows={4} value={text} maxLength={MACRO_TEXT_MAX} onChange={(e) => setText(e.target.value)} dir="ltr" placeholder={'/me headbangs\n/topic Nu-metal Friday'} />
        </label>
        <p className="muted">{t('macroTextHint')}</p>
        <div className="irc-dialog-buttons">
          <button type="button" className="irc-tool" disabled={!ok} onClick={() => onSave({ id: macro.id, label: label.trim(), text: text.replace(/\r/g, '') })}>
            {t('save')}
          </button>
          {!isNew && (
            <button type="button" className="irc-tool" onClick={() => onDelete(macro)}>
              {t('remove')}
            </button>
          )}
          <button type="button" className="irc-tool" onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
