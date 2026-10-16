// The chat's help: every command, the formatting keys, macros and tips. Opened from the toolbar's
// Help button; /help prints the command list into the current window.
import { useI18n, type StringKey } from '../i18n';

/** Each command with its syntax; the explanation is translated (i18n keys help_<name>). */
export const COMMANDS: { syntax: string; key: StringKey }[] = [
  { syntax: '/join #channel', key: 'help_join' },
  { syntax: '/part [reason]', key: 'help_part' },
  { syntax: '/me does something', key: 'help_me' },
  { syntax: '/msg nick text', key: 'help_msg' },
  { syntax: '/query nick', key: 'help_query' },
  { syntax: '/nick NewNick', key: 'help_nick' },
  { syntax: '/topic [text]', key: 'help_topic' },
  { syntax: '/away [message]', key: 'help_away' },
  { syntax: '/whois nick', key: 'help_whois' },
  { syntax: '/list', key: 'help_list' },
  { syntax: '/op /deop nick', key: 'help_op' },
  { syntax: '/voice /devoice nick', key: 'help_voice' },
  { syntax: '/kick nick [reason]', key: 'help_kick' },
  { syntax: '/ban /unban nick', key: 'help_ban' },
  { syntax: '/mode +m | -m', key: 'help_mode_m' },
  { syntax: '/mode +t | -t', key: 'help_mode_t' },
  { syntax: '/clear', key: 'help_clear' },
  { syntax: '/close', key: 'help_close' },
  { syntax: '/help', key: 'help_help' },
];

const KEYS: { keys: string; key: StringKey }[] = [
  { keys: 'Ctrl+K', key: 'help_key_color' },
  { keys: 'Ctrl+B', key: 'help_key_bold' },
  { keys: 'Ctrl+U', key: 'help_key_underline' },
  { keys: 'Ctrl+I', key: 'help_key_italic' },
  { keys: 'Ctrl+O', key: 'help_key_plain' },
  { keys: '↑ ↓', key: 'help_key_history' },
];

const TIPS: StringKey[] = ['help_tip_pm', 'help_tip_nicklist', 'help_tip_unread', 'help_tip_slash', 'help_tip_log'];

const PRIVACY: StringKey[] = ['help_privacy_stored', 'help_privacy_channels', 'help_privacy_pm', 'help_privacy_admin', 'help_privacy_bot', 'help_privacy_secrets'];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <aside className="irc-help" dir={lang === 'he' ? 'rtl' : 'ltr'} aria-label={t('helpTitle')}>
      <div className="irc-help-title">
        <span>{t('helpTitle')}</span>
        <button type="button" onClick={onClose} aria-label={t('close')}>
          ✕
        </button>
      </div>
      <div className="irc-help-body">
        <h4>{t('helpCommands')}</h4>
        <table>
          <tbody>
            {COMMANDS.map((c) => (
              <tr key={c.syntax}>
                <td dir="ltr">
                  <code>{c.syntax}</code>
                </td>
                <td>{t(c.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>{t('helpKeys')}</h4>
        <table>
          <tbody>
            {KEYS.map((k) => (
              <tr key={k.keys}>
                <td dir="ltr">
                  <kbd>{k.keys}</kbd>
                </td>
                <td>{t(k.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>{t('helpMacros')}</h4>
        <p>{t('help_macros_1')}</p>
        <p>{t('help_macros_2')}</p>
        <p>{t('help_macros_3')}</p>

        <h4>{t('helpTips')}</h4>
        <ul>
          {TIPS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>

        <h4>{t('helpPrivacy')}</h4>
        <ul className="irc-privacy">
          {PRIVACY.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
