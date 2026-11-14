'use client';

import { showDialog } from '@/components/calendar/show-dialog';
import type { ErrorCode } from '@caltracker/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  IsoDateSchema,
  assignSummary,
  copyDefaultDate,
  earliestProgramStart,
  filterClients,
  nextFreeDay,
  nextMonday,
  plannedLabel,
  programClashes,
  programStartError,
  scheduleDateError,
  workoutClashes,
} from '@caltracker/shared';
import { errorMessage, type IsoDate, type ProgramClash } from '@caltracker/shared';
import {
  assignToClients,
  loadAssignTargets,
  type AssignClient,
  type AssignTargets,
  type ClientResult,
} from '@/app/(coach)/assign/actions';
import { formatShortDay } from '@/components/calendar/format';
import { ReloadButton } from '@/components/reload-button';
import { avatarTone, initials } from '@/app/(coach)/clients/avatar';
import { Button, Chip, ErrorText, type FieldError } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import sheet from '@/components/ui/sheet.module.css';
import { failureCode, isStaleDeployError } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import calendar from '@/components/calendar/calendar.module.css';
import { DialogHeader } from './dialog-header';
import { QuickDayPicker, type QuickDayPickerHandle } from './quick-day-picker';
import styles from './assign.module.css';

export type AssignKind = 'workout' | 'program' | 'copy';
/** For a copy (Copy to… on a calendar workout), `date` is the workout's own day. */
type Source = { kind: AssignKind; id: string; name: string; date?: IsoDate };

const nameOf = (c: AssignClient) => `${c.firstName} ${c.lastName}`.trim() || 'Client';
const MAYBE_SENT = 'Check the calendars before assigning again: the first try may have gone through.';

/**
 * "Assign" on a library workout or program: opens the dialog, and after a full success closes it and says so in a
 * toast (a partial one keeps the dialog open with each client's answer).
 */
export function AssignButton({ kind, id, name, compact = false }: { kind: 'workout' | 'program'; id: string; name: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      {compact ? (
        <button type="button" className={styles.small} aria-label={`Assign ${name}`} onClick={() => setOpen(true)} data-ph-capture-attribute-label="assign_open">
          Assign
        </button>
      ) : (
        <Button onClick={() => setOpen(true)} data-ph-capture-attribute-label="assign_open" data-ph-safe="">
          Assign {kind}
        </Button>
      )}
      {open ? (
        <AssignToClientsDialog
          source={{ kind, id, name }}
          onDone={(message) => {
            setOpen(false);
            setToast(message);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <div className={calendar.toastRegion} aria-live="polite">
        {toast ? (
          <div className={calendar.toast}>
            <span>{toast}</span>
            <button type="button" className={calendar.smallButton} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Pick clients (current ones, searchable) and a day, then one "Assign" (or, for Copy to…, one "Copy"). A workout goes on today by default, or on
 * each client's next free day; a program starts next Monday by default (up to 7 days back is allowed, as on the
 * calendar). Days that already have workouts are listed first, and the button says "Add alongside": nothing already
 * there is replaced. Each client gets its own id per day, kept while the dialog is open, so a retry after a lost
 * answer never copies twice.
 */
export function AssignToClientsDialog({
  source,
  preselect = [],
  onDone,
  onClose,
}: {
  source: Source;
  /** Clients ticked to start with (Copy to… ticks the workout's own client). */
  preselect?: readonly string[];
  /** Every selected client got it: the summary to show. */
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const today = useLocalToday();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const listId = useId();
  const dateInputId = useId();
  const dayPicker = useRef<QuickDayPickerHandle>(null);
  const clashTitleId = useId();
  // A copy is placed like a single workout: one day per client.
  const isWorkout = source.kind !== 'program';
  const isCopy = source.kind === 'copy';
  const verb = isCopy ? 'Copied' : 'Assigned';
  const [targets, setTargets] = useState<AssignTargets | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  const [freeDay, setFreeDay] = useState(false);
  const [date, setDate] = useState<string>(() =>
    isCopy && source.date ? copyDefaultDate(source.date, today) : isWorkout ? today : nextMonday(today),
  );
  const [results, setResults] = useState<ReadonlyMap<string, ClientResult>>(new Map());
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const busy = useRef(false);
  // One id per client and day: retrying the same choice repeats it (the database copies once); another day gets a new one.
  const ids = useRef(new Map<string, string>());
  const idFor = (clientId: string, day: IsoDate) => {
    const key = `${clientId}|${day}`;
    let id = ids.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(key, id);
    }
    return id;
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The client list shows with its search box ready; on a phone the keyboard waits for a tap on it.
    if (dialog) showDialog(dialog, { noKeyboardOnTouch: true });
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadAssignTargets({ programId: isWorkout ? null : source.id })
      .then((t) => {
        if (live) setTargets(t);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(failureCode(e, 'clients_load_failed'));
      });
    return () => {
      live = false;
    };
  }, [isWorkout, source.id]);

  const byClient = useMemo(() => {
    const m = new Map<string, { date: IsoDate; name: string }[]>();
    for (const s of targets?.scheduled ?? []) {
      const list = m.get(s.clientId) ?? [];
      list.push({ date: s.date, name: s.name });
      m.set(s.clientId, list);
    }
    return m;
  }, [targets]);

  const validDate = IsoDateSchema.safeParse(date).success;
  const useFreeDay = isWorkout && freeDay;
  const dateError = useFreeDay
    ? null
    : !validDate
      ? 'Pick a date.'
      : isWorkout
        ? scheduleDateError(date, today)
        : programStartError(date, today);
  const dayFor = (clientId: string): IsoDate =>
    useFreeDay ? nextFreeDay(today, (byClient.get(clientId) ?? []).map((w) => w.date)) : date;
  const clashesFor = (clientId: string): ProgramClash[] => {
    if (dateError) return [];
    const existing = byClient.get(clientId) ?? [];
    if (isWorkout) return workoutClashes(dayFor(clientId), existing);
    return targets?.program ? programClashes(targets.program, date, existing) : [];
  };

  const clients = targets?.clients ?? [];
  const planned = (clientId: string) => plannedLabel(today, (byClient.get(clientId) ?? []).map((w) => w.date));
  const shown = filterClients(clients, query);
  const assigned = (id: string) => results.get(id)?.ok === true;
  const chosen = clients.filter((c) => selected.has(c.id) && !assigned(c.id));
  const clashing = chosen.map((c) => ({ client: c, clashes: clashesFor(c.id) })).filter((x) => x.clashes.length > 0);
  const missingProgram = !isWorkout && targets !== null && targets.program === null;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  async function assign() {
    if (busy.current || chosen.length === 0 || dateError || missingProgram) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const sent = chosen.map((c) => {
      const day = dayFor(c.id);
      return { clientId: c.id, date: day, id: idFor(c.id, day) };
    });
    try {
      const outcome = await assignToClients({ kind: source.kind, sourceId: source.id, today, targets: sent });
      if (!outcome.ok) {
        setError({ code: outcome.code });
        return;
      }
      setUncertain(false);
      const next = new Map(results);
      for (const r of outcome.results) next.set(r.clientId, r);
      // Earlier successes count too, so the summary covers the whole dialog.
      const all = [...next.values()];
      if (outcome.results.every((r) => r.ok)) {
        onDone(assignSummary(source.name, all, verb));
        return;
      }
      setResults(next);
      // The summary names the program or workout, so it stays hidden in recordings.
      setError({ code: 'assign_partial_failed', text: assignSummary(source.name, all, verb), safe: false });
    } catch (e) {
      // The same clients and days keep their ids, so trying again can't copy twice.
      setError({ code: failureCode(e, isCopy ? 'copy_offline' : 'assign_offline') });
      if (!isStaleDeployError(e)) setUncertain(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const n = chosen.length;
  const action = isCopy ? 'Copy' : 'Assign';
  const label = pending
    ? `${isCopy ? 'Copying' : 'Assigning'}…`
    : clashing.length > 0
      ? 'Add alongside'
      : n > 1
        ? `${action} to ${n} clients`
        : action;

  return (
    <dialog
      ref={dialogRef}
      // On an iPhone it fills the screen: the client list takes the spare height and the buttons stay at the bottom.
      className={cx(calendar.dialog, sheet.sheet)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onClose}
    >
      <DialogHeader
        titleId={titleId}
        title={isCopy ? `Copy ${source.name} to…` : `Assign ${source.name}`}
        onClose={() => dialogRef.current?.close()}
        disabled={pending}
      />
      {isCopy ? (
        <p className={calendar.dialogBody}>
          Copies it as it is now, with your changes, as a separate workout: later program or library edits won&apos;t
          change the copy.
        </p>
      ) : null}
      {loadError ? (
        <ErrorText code={loadError} />
      ) : targets === null ? (
        <p className={calendar.caption} role="status">Loading clients…</p>
      ) : clients.length === 0 ? (
        <p className={calendar.dialogBody}>You have no clients yet. Invite one from Clients first.</p>
      ) : (
        <>
          <label className={calendar.searchLabel}>
            <span>Search clients</span>
            <input
              type="search"
              className={calendar.input}
              value={query}
              aria-controls={listId}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.listHead}>
            <span className={calendar.caption}>{n === 0 ? 'No clients picked' : `${n} picked`}</span>
            {shown.some((c) => !selected.has(c.id) && !assigned(c.id)) ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setSelected((s) => new Set([...s, ...shown.filter((c) => !assigned(c.id)).map((c) => c.id)]))}
              >
                Select all{query.trim() ? ' shown' : ''}
              </button>
            ) : n > 0 ? (
              <button type="button" className={styles.linkButton} onClick={() => setSelected(new Set())}>
                Clear
              </button>
            ) : null}
          </div>
          <ul id={listId} className={cx(styles.clients, sheet.grow)} aria-label="Clients">
            {shown.length === 0 ? <li className={calendar.caption}>No clients match.</li> : null}
            {shown.map((c) => {
              const result = results.get(c.id);
              const on = selected.has(c.id) && !assigned(c.id);
              const clashes = on ? clashesFor(c.id) : [];
              return (
                <li key={c.id} className={styles.client}>
                  <label className={styles.clientLabel}>
                    <input type="checkbox" checked={on || assigned(c.id)} disabled={assigned(c.id) || pending} onChange={() => toggle(c.id)} data-ph-capture-attribute-label="assign_pick_client" />
                    <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(c.id)}`])}>
                      {initials(nameOf(c))}
                    </span>
                    <span className={styles.clientName}>{nameOf(c)}</span>
                  </label>
                  {result?.ok ? (
                    <span className={styles.done}>{verb} ✓</span>
                  ) : result && !result.ok && on ? (
                    <span className={styles.failed}>{errorMessage(result.code)}</span>
                  ) : on && useFreeDay ? (
                    <span className={styles.note}>{formatShortDay(dayFor(c.id))}</span>
                  ) : clashes.length > 0 ? (
                    <span className={styles.note}>{isWorkout ? 'Has a workout that day' : 'Has workouts on some days'}</span>
                  ) : (
                    <Chip tone={planned(c.id) === 'Nothing planned' ? 'lime' : 'grey'} className={styles.statusChip}>
                      {planned(c.id)}
                    </Chip>
                  )}
                </li>
              );
            })}
          </ul>

          {isWorkout ? (
            <fieldset className={styles.modes}>
              <legend>Which day</legend>
              <label className={styles.mode}>
                <input type="radio" name={`${titleId}-mode`} checked={!freeDay} onChange={() => setFreeDay(false)} />
                <span>The same day for everyone</span>
              </label>
              <label className={styles.mode}>
                <input type="radio" name={`${titleId}-mode`} checked={freeDay} onChange={() => setFreeDay(true)} />
                <span>Each client&apos;s next free day</span>
              </label>
            </fieldset>
          ) : null}
          {useFreeDay ? null : (
            <QuickDayPicker
              ref={dayPicker}
              legend={isWorkout ? 'Day' : 'Start'}
              today={today}
              value={date}
              onChange={(d) => {
                setDate(d);
                setError(null);
              }}
              inputId={dateInputId}
              captureLabel="assign_pick_date"
              fieldLabel={isWorkout ? 'Date' : 'Start date'}
              fieldMin={isWorkout ? today : earliestProgramStart(today)}
              error={dateError}
            />
          )}
          {!isWorkout && !dateError && date < today ? (
            <p className={calendar.pastNote}>
              <span aria-hidden="true" className={calendar.pastMarker}>●</span>
              <span>This start date is in the past. Workouts before today will show as missed later.</span>
            </p>
          ) : null}
          {missingProgram ? <ErrorText code="program_missing" /> : null}
          {clashing.length > 0 ? (
            <section className={calendar.clashNote} aria-labelledby={clashTitleId} role="status">
              <p id={clashTitleId} className={calendar.clashTitle}>
                <span aria-hidden="true" className={calendar.pastMarker}>●</span>{' '}
                {clashing.length === 1 ? '1 client already has' : `${clashing.length} clients already have`} a workout on{' '}
                {isWorkout ? 'that day' : 'some of these days'}
              </p>
              <ul className={calendar.clashList}>
                {clashing.map(({ client, clashes }) => (
                  <li key={client.id}>
                    {nameOf(client)}: {clashes.map((x) => `${formatShortDay(x.date)} (${x.names.join(', ')})`).join('; ')}
                  </li>
                ))}
              </ul>
              <p className={calendar.dialogBody}>
                Pick another date, or add alongside these. Nothing already there is replaced.
              </p>
            </section>
          ) : null}
        </>
      )}
      {error ? <ErrorText code={error.code} safe={error.safe}>
          {error.text}
        </ErrorText> : null}
      {uncertain ? (
        <p className={calendar.pastNote}>
          <span aria-hidden="true" className={calendar.pastMarker}>●</span>
          <span>{MAYBE_SENT}</span>
        </p>
      ) : null}
      <div className={cx(calendar.dialogActions, sheet.actions)}>
        {error?.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending} data-ph-capture-attribute-label="assign_cancel" data-ph-safe="">
          {results.size > 0 ? 'Close' : 'Cancel'}
        </Button>
        {clashing.length > 0 && !useFreeDay ? (
          <Button variant="secondary" onClick={() => dayPicker.current?.openField()} disabled={pending}>
            Pick another date
          </Button>
        ) : null}
        {clients.length > 0 ? (
          <Button onClick={() => void assign()} pending={pending} disabled={n === 0 || dateError !== null || missingProgram} data-ph-capture-attribute-label="assign_save">
            {label}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
