import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { NAV_ICONS, type NavIconName } from '../nav-icons';
import { HOW_TOS } from './how-tos';
import { SupportBox } from './support-box';
import styles from './help.module.css';

export const metadata = { title: 'Help' };

const Chevron = () => (
  <svg className={styles.chevron} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** A body inside scan corners: "Add a body scan" links to Clients too, so it would otherwise repeat Invite's icon. */
const ScanIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <circle cx="12" cy="8" r="2" />
    <path d="M8.5 17c.4-2.8 1.7-4.5 3.5-4.5s3.1 1.7 3.5 4.5" />
  </svg>
);

/** Each how-to is independent, so it gets the icon of the page it's about (numbers suggested a sequence). */
function topicIcon(href: string): NavIconName {
  const name = href.replace(/^\//, '');
  return name in NAV_ICONS ? (name as NavIconName) : 'help';
}

/** Help: five short how-tos that open in place, and how to reach support (copy the address, or open the mail app). */
export default function HelpPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Help" subtitle={<span data-ph-safe="">Short how-tos. Still stuck? Write to us, we reply within a working day.</span>} />
      <ul className={styles.list} aria-label="How-tos">
        {HOW_TOS.map((h, i) => (
          <li key={h.title}>
            <details className={styles.howTo}>
              <summary className={styles.summary} data-ph-capture-attribute-label={`help_howto_${i + 1}`}>
                <span className={styles.topicIcon} aria-hidden="true">
                  {h.icon === 'scan' ? ScanIcon : NAV_ICONS[topicIcon(h.link.href)]}
                </span>
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
