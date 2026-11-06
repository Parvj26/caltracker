import type { SearchHit } from '@caltracker/shared';
import { Chip } from '@/components/ui';
import { Photo } from './photo';
import { FavouriteButton } from './favourite-button';
import styles from './exercise-search.module.css';

type Props = {
  listId: string;
  hits: SearchHit[];
  shown: number;
  activeId: string | undefined;
  /** Ticked rows in multi-pick mode. */
  selectedIds: ReadonlySet<string> | null;
  favourites: ReadonlySet<string>;
  imageUrl: (path: string) => string;
  optionId: (id: string) => string;
  onActivate: (id: string) => void;
  onToggleFavourite: (id: string) => void;
  onShowMore: () => void;
};

/** The name with the matched words marked. */
function Highlighted({ name, ranges }: { name: string; ranges: Array<[number, number]> }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at) continue;
    if (s > at) parts.push(name.slice(at, s));
    parts.push(<mark key={s} className={styles.mark}>{name.slice(s, e)}</mark>);
    at = e;
  }
  if (at < name.length) parts.push(name.slice(at));
  return <>{parts}</>;
}

export function ResultList({
  listId, hits, shown, activeId, selectedIds, favourites, imageUrl, optionId, onActivate, onToggleFavourite, onShowMore,
}: Props) {
  const visible = hits.slice(0, shown);
  return (
    <div className={styles.listWrap}>
      <ul id={listId} role="listbox" aria-label="Exercises" aria-multiselectable={selectedIds ? true : undefined} className={styles.list}>
        {visible.map(({ row, highlight }) => {
          const active = row.id === activeId;
          const picked = selectedIds ? selectedIds.has(row.id) : active;
          return (
            <li key={row.id} role="presentation" className={styles.rowWrap} data-active={active || undefined}>
              <div
                id={optionId(row.id)}
                role="option"
                aria-selected={picked}
                aria-label={row.name}
                className={styles.row}
                onClick={() => onActivate(row.id)}
              >
                {selectedIds ? <span className={styles.box} aria-hidden="true">{picked ? '✓' : ''}</span> : null}
                <Photo src={row.imagePath ? imageUrl(row.imagePath) : null} alt="" width={48} height={48} className={styles.thumb} />
                <span className={styles.rowText} aria-hidden="true">
                  <span className={styles.rowName}><Highlighted name={row.name} ranges={highlight} /></span>
                  <span className={styles.tags}>
                    {row.primaryMuscles.slice(0, 2).map((m) => <Chip key={m} tone="pink">{m}</Chip>)}
                    {row.equipment ? <Chip tone="grey">{row.equipment}</Chip> : null}
                    {row.source === 'custom' ? <Chip tone="lime">Custom</Chip> : null}
                  </span>
                </span>
              </div>
              <FavouriteButton name={row.name} favourite={favourites.has(row.id)} onToggle={() => onToggleFavourite(row.id)} />
            </li>
          );
        })}
      </ul>
      {hits.length > shown ? (
        <button type="button" className={styles.showMore} onClick={onShowMore}>
          Show more ({hits.length - shown} left)
        </button>
      ) : null}
    </div>
  );
}
