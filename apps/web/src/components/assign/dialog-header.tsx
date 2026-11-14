import calendar from '@/components/calendar/calendar.module.css';
import { cx } from '@/components/ui/cx';
import sheet from '@/components/ui/sheet.module.css';
import styles from './assign.module.css';

/**
 * The top of a pop-up window: its title (and an optional line under it) with a ✕ to close. On a phone it is the
 * full-screen sheet's bar, stuck to the top while the sheet scrolls; the ✕ shows on touch screens and narrow windows
 * (sheet.module.css), where there is no Escape key.
 */
export function DialogHeader({
  titleId,
  title,
  subtitle,
  onClose,
  disabled = false,
  titleSafe = false,
}: {
  titleId: string;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  disabled?: boolean;
  /** The title is fixed product copy (no names): shown in session recordings. */
  titleSafe?: boolean;
}) {
  return (
    <div className={cx(sheet.header, styles.dialogHeader)}>
      <div className={styles.dialogHeading}>
        <h2 id={titleId} className={cx(calendar.dialogTitle, styles.dialogTitleText)} {...(titleSafe ? { 'data-ph-safe': '' } : {})}>
          {title}
        </h2>
        {subtitle ? <p className={styles.dialogSubtitle}>{subtitle}</p> : null}
      </div>
      <button type="button" className={sheet.close} aria-label="Close" onClick={onClose} disabled={disabled}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
