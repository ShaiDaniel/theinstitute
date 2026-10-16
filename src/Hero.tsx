// The home page's opening: a dim, slowly drifting wall of the group's own covers (only what members
// shared publicly, or with members), film grain and one red light, under the name. Before there are
// enough covers, a record turning slowly, half out of the frame. Motion stops for people who ask
// their system to reduce it.
import { useChatDock } from './ChatDock';
import { signIn } from './firebase';
import { useI18n } from './i18n';
import { hrefOf } from './route';

/** Fewer covers than this and the wall looks thin: show the record instead. */
const MIN_COVERS = 8;
const ROWS = 3;

export function Hero({ covers, name, signedIn }: { covers: string[]; name: string | null; signedIn: boolean }) {
  const { t } = useI18n();
  const dock = useChatDock();
  const unique = [...new Set(covers)];
  const wall = unique.length >= MIN_COVERS;

  // Each row gets its own slice and runs twice in a row, so the drift loops without a seam.
  const rows = Array.from({ length: ROWS }, (_, r) => {
    const row = unique.filter((_, i) => i % ROWS === r);
    while (row.length && row.length < 10) row.push(...row.slice(0, 10 - row.length));
    return row;
  });

  return (
    <section className={`hero ${name ? 'compact' : ''}`} aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden>
        {wall ? (
          <div className="cover-wall">
            {rows.map((row, r) => (
              <div key={r} className={`cover-row ${r % 2 ? 'reverse' : ''}`} style={{ animationDuration: `${90 + r * 25}s` }}>
                {[...row, ...row].map((src, i) => (
                  <img key={i} src={src} alt="" loading="lazy" decoding="async" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          // The record turns; the light on it doesn't.
          <div className="vinyl-wrap">
            <div className="vinyl">
              <div className="vinyl-label">
                <span>THE INSTITUTE</span>
                <small>SIDE A · 33⅓</small>
              </div>
            </div>
          </div>
        )}
        <div className="hero-shade" />
        <div className="hero-grain" />
      </div>

      <div className="hero-content">
        <p className="hero-eyebrow">{t('heroEyebrow')}</p>
        <h2 id="hero-title" className="hero-title">
          {name ? t('heroWelcome').replace('{name}', name) : 'The Institute'}
        </h2>
        <p className="hero-line">{t(name ? 'heroLineMember' : 'heroLine')}</p>
        <div className="hero-actions">
          {signedIn ? (
            <a className="btn primary" href={hrefOf('showcase')}>
              {t('heroYourLists')}
            </a>
          ) : (
            <button type="button" className="btn primary" onClick={() => signIn().catch(() => {})}>
              {t('heroSignIn')}
            </button>
          )}
          {name ? (
            <button type="button" className="btn ghost" onClick={dock.open}>
              {t('heroChat')}
            </button>
          ) : (
            <a className="btn ghost" href={hrefOf('people')}>
              {t('heroBrowse')}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
