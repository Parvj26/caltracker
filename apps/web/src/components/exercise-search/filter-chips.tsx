import { EQUIPMENT_CHIPS, MUSCLE_CHIPS, type SearchFilters } from '@caltracker/shared';
import styles from './exercise-search.module.css';

type Props = { filters: SearchFilters; onChange: (next: SearchFilters) => void };

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.filter} aria-pressed={active} onClick={onClick}>
      {label}
      {active ? <span aria-hidden="true"> ✕</span> : null}
    </button>
  );
}

export function hasActiveFilters(f: SearchFilters): boolean {
  return f.muscles.length > 0 || f.equipment.length > 0 || f.customOnly;
}

/** Muscle and equipment chips (OR inside a group, AND between groups) and "Custom only". */
export function FilterChips({ filters, onChange }: Props) {
  return (
    <div className={styles.filters} role="group" aria-label="Filters">
      {MUSCLE_CHIPS.map((m) => (
        <Chip key={m} label={m} active={filters.muscles.includes(m)} onClick={() => onChange({ ...filters, muscles: toggle(filters.muscles, m) })} />
      ))}
      <span className={styles.filterGap} aria-hidden="true" />
      {EQUIPMENT_CHIPS.map((q) => (
        <Chip key={q} label={q} active={filters.equipment.includes(q)} onClick={() => onChange({ ...filters, equipment: toggle(filters.equipment, q) })} />
      ))}
      <span className={styles.filterGap} aria-hidden="true" />
      <Chip label="Custom only" active={filters.customOnly} onClick={() => onChange({ ...filters, customOnly: !filters.customOnly })} />
    </div>
  );
}
