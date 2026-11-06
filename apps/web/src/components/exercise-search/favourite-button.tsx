import styles from './exercise-search.module.css';

type Props = { name: string; favourite: boolean; onToggle: () => void };

/** A star toggle. Sits beside a result row (not inside it) so the row stays a single option. */
export function FavouriteButton({ name, favourite, onToggle }: Props) {
  return (
    <button
      type="button"
      className={styles.star}
      aria-pressed={favourite}
      aria-label={`Favourite ${name}`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{favourite ? '★' : '☆'}</span>
    </button>
  );
}
