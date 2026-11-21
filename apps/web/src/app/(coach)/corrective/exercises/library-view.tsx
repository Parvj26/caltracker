'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DIRECTION_LABELS, doseText, muscleGroup, type MuscleId } from '@caltracker/shared';
import { Button, ListRow, PageHeader, RowList, SearchBox, SearchEmpty, useSearchQuery } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { MoreMenu } from '@/components/more-menu';
import { filterLibrary, groupLibrary, libraryMuscles, type LibraryItem, type LibraryShow } from '@/lib/corrective-library';
import { replaceParam } from '@/lib/url-state';
import { CorrectiveDialog, type DialogStart } from './corrective-dialog';
import { CorrectiveSummary, DirectionTag, Thumb, YoursChip } from './parts';
import styles from './corrective.module.css';

/** Desktop (labelled sidebar): the list with the open item beside it. Below, a tap opens the item in a pop-up. */
const WIDE_QUERY = '(min-width: 1200px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(WIDE_QUERY);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

const SHOWS: { id: LibraryShow; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'under', label: '↓ Under' },
  { id: 'over', label: '↑ Over' },
  { id: 'yours', label: 'Yours' },
];

/**
 * Library › Corrective › Exercises (board AS8): the coach's corrective exercises ("Yours", first) and the built-in
 * defaults, grouped by muscle and direction, with a search (shared smart search), All / Under / Over / Yours and a
 * muscle filter. Phone: one list. iPad: groups in two columns. Desktop: the list and the open exercise side by side.
 */
export function CorrectiveLibrary({
  workspaceId,
  items,
  builtins,
  initialShow,
  initialMuscle,
  tabs,
}: {
  workspaceId: string;
  items: LibraryItem[];
  builtins: LibraryItem[];
  initialShow: LibraryShow;
  initialMuscle: MuscleId | null;
  /** The Library and Corrective section rows. */
  tabs?: ReactNode;
}) {
  const wide = useWide();
  const { query, setQuery, debounced } = useSearchQuery({ urlParam: 'q' });
  const [show, setShow] = useState<LibraryShow>(initialShow);
  const [muscle, setMuscle] = useState<MuscleId | null>(initialMuscle);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogStart | null>(null);

  const shown = useMemo(() => filterLibrary(items, { query: debounced, show, muscle }), [items, debounced, show, muscle]);
  const groups = useMemo(() => groupLibrary(shown, muscle), [shown, muscle]);
  const muscles = useMemo(() => libraryMuscles(items), [items]);
  const current = (selected ? shown.find((i) => i.key === selected) : undefined) ?? groups[0]?.items[0] ?? null;

  const pickShow = (s: LibraryShow) => {
    setShow(s);
    replaceParam('show', s === 'all' ? '' : s, '');
  };
  const pickMuscle = (m: MuscleId | null) => {
    setMuscle(m);
    replaceParam('muscle', m ?? '', '');
  };
  const open = (item: LibraryItem) => {
    if (wide) setSelected(item.key);
    else setDialog({ step: 'view', item });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Corrective"
        count={items.length}
        stackOnPhone
        action={
          <Button variant="create" className={styles.createButton} onClick={() => setDialog({ step: 'edit', item: null })} data-ph-capture-attribute-label="corrective_new" phSafe>
            + Corrective exercise
          </Button>
        }
      />
      {tabs}
      <div className={styles.layout}>
        <div className={styles.listCol}>
          <div className={styles.filters}>
            <SearchBox value={query} onChange={setQuery} label="Search corrective exercises" />
            <div className={styles.chipRow} role="group" aria-label="Show">
              {SHOWS.map((s) => (
                <button key={s.id} type="button" className={styles.filterChip} aria-pressed={show === s.id} onClick={() => pickShow(s.id)} data-ph-safe="">
                  {s.label}
                </button>
              ))}
            </div>
            <div className={styles.muscleStrip} role="group" aria-label="Muscle group">
              <button type="button" className={styles.filterChip} aria-pressed={muscle === null} onClick={() => pickMuscle(null)}>
                All muscles
              </button>
              {muscles.map((m) => (
                <button key={m} type="button" className={styles.filterChip} aria-pressed={muscle === m} onClick={() => pickMuscle(muscle === m ? null : m)}>
                  {muscleGroup(m)?.name ?? m}
                </button>
              ))}
            </div>
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>No corrective exercises yet.</p>
          ) : groups.length === 0 ? (
            debounced.trim() ? (
              <SearchEmpty things="corrective exercises" query={debounced} onClear={() => setQuery('')} />
            ) : (
              <p className={styles.empty}>Nothing matches these filters.</p>
            )
          ) : (
            <div className={styles.groups} data-testid="corrective-groups">
              {groups.map((g) => (
                <section key={`${g.direction}.${g.muscleId}`} className={styles.group} aria-labelledby={`grp-${g.direction}-${g.muscleId}`}>
                  <header className={styles.groupHead}>
                    <h2
                      id={`grp-${g.direction}-${g.muscleId}`}
                      className={styles.groupTitle}
                      aria-label={`${muscleGroup(g.muscleId)?.name ?? g.muscleId}, ${DIRECTION_LABELS[g.direction].long.toLowerCase()}`}
                    >
                      {muscleGroup(g.muscleId)?.name ?? g.muscleId}
                    </h2>
                    <span aria-hidden="true">
                      <DirectionTag direction={g.direction} />
                    </span>
                    <span className={styles.groupAction} aria-hidden="true">
                      {DIRECTION_LABELS[g.direction].action}
                    </span>
                  </header>
                  <RowList>
                    {g.items.map((item) => (
                      <ListRow
                        key={item.key}
                        onOpen={() => open(item)}
                        openLabel={`${item.name}${item.yours ? ', yours' : ''}, ${doseText(item.dose)}`}
                        current={wide && current?.key === item.key}
                        leading={<Thumb item={item} />}
                        title={
                          <span className={styles.rowTitle}>
                            {item.name}
                            {item.yours ? <YoursChip /> : null}
                          </span>
                        }
                        meta={doseText(item.dose)}
                        end={<ChevronIcon direction="right" />}
                        itemProps={{ 'data-corrective': item.key }}
                      />
                    ))}
                  </RowList>
                </section>
              ))}
            </div>
          )}
        </div>

        {wide && current ? (
          <aside className={styles.pane} aria-label="Open corrective exercise" data-testid="corrective-pane">
            <CorrectiveSummary
              item={current}
              actions={
                current.yours ? (
                  <>
                    <Button variant="secondary" size="compact" onClick={() => setDialog({ step: 'edit', item: current })}>
                      Edit
                    </Button>
                    <MoreMenu
                      label={`More for ${current.name}`}
                      items={[{ label: 'Delete…', danger: true, onSelect: () => setDialog({ step: 'delete', item: current }) }]}
                    />
                  </>
                ) : (
                  <Button variant="secondary" size="compact" onClick={() => setDialog({ step: 'edit', item: current })}>
                    Make it yours
                  </Button>
                )
              }
            />
          </aside>
        ) : null}
      </div>

      {dialog ? (
        <CorrectiveDialog
          key={`${dialog.step}-${dialog.item?.key ?? 'new'}`}
          start={dialog}
          workspaceId={workspaceId}
          builtins={builtins}
          onClose={() => setDialog(null)}
          onSaved={(key) => setSelected(key)}
        />
      ) : null}
    </div>
  );
}

