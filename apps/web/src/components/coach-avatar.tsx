import { avatarTone, initials } from '@/app/(coach)/clients/avatar';
import { cx } from '@/components/ui/cx';
import { StableImg } from './stable-img';
import styles from './coach-avatar.module.css';

/**
 * The coach's round photo, or their initials on a pastel when there is no photo. `url` is a short-lived signed link
 * made on the server (the bucket is private). The picture is decorative: the name always sits next to it.
 */
export function CoachAvatar({
  url,
  name,
  seed,
  size = 'small',
}: {
  url: string | null;
  name: string;
  /** A stable key (the user id) so the initials keep their colour. */
  seed: string;
  size?: 'small' | 'large';
}) {
  const sizeClass = size === 'large' ? styles.large : styles.small;
  if (url) {
    // Keeps the first signed link across re-renders (live updates), so the photo is not downloaded again each time.
    return <StableImg src={url} className={cx(styles.avatar, sizeClass)} />;
  }
  return (
    <span aria-hidden="true" className={cx(styles.avatar, sizeClass, styles[avatarTone(seed)])}>
      {initials(name)}
    </span>
  );
}
