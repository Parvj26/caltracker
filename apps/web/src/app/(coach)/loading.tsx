import styles from './loading.module.css';

/** Shown the moment a coach page is opened, until its data has loaded: a title and a few grey cards. */
export default function Loading() {
  return (
    <div className={styles.page} role="status" aria-label="Loading">
      <div className={styles.bar} />
      <div className={styles.title} />
      <div className={styles.line} />
      <div className={styles.card} />
      <div className={styles.card} />
    </div>
  );
}
