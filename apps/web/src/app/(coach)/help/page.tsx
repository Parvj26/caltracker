import Link from 'next/link';
import { HOW_TOS } from './how-tos';
import { SupportBox } from './support-box';
import styles from './help.module.css';

export const metadata = { title: 'Help' };

const Chevron = () => (
  <svg className={styles.chevron} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Help: five short how-tos that open in place, and how to reach support (copy the address, or open the mail app). */
export default function HelpPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Help</h1>
        <p className={styles.caption} data-ph-safe="">Short how-tos. Still stuck? Write to us, we reply within a working day.</p>
      </header>
      <ul className={styles.list} aria-label="How-tos">
        {HOW_TOS.map((h, i) => (
          <li key={h.title}>
            <details className={styles.howTo}>
              <summary className={styles.summary} data-ph-capture-attribute-label={`help_howto_${i + 1}`}>
                <span className={styles.number} aria-hidden="true">{i + 1}</span>
                <span className={styles.howToTitle} data-ph-safe="">{h.title}</span>
                <Chevron />
              </summary>
              <ol className={styles.steps}>
                {h.steps.map((s, j) => (
                  <li key={j} className={styles.step} data-ph-safe="">
                    <span className={styles.stepNumber} aria-hidden="true">{j + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <Link href={h.link.href} className={styles.goLink} data-ph-safe="">
                {h.link.label}
              </Link>
            </details>
          </li>
        ))}
      </ul>
      <SupportBox />
    </div>
  );
}
