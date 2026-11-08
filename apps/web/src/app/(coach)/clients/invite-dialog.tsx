'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  INVITE_PLAN_MAX_WORKOUTS,
  InviteInput,
  IsoDateSchema,
  addDays,
  invitePlanError,
  isoWeekday,
  localToday,
  type InvitePlan,
  type IsoDate,
} from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { Button, ButtonLink, ErrorText, SelectField, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureMessage } from '@/lib/action-errors';
import { useBrowserToday } from '@/lib/local-today';
import type { PickerHints } from '@/lib/picker-hints';
import { inviteClient } from './actions';
import { CsvUpload } from './csv-upload';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';
import { track } from '@/lib/analytics/client';

type LibraryWorkout = { id: string; name: string };
type Program = { id: string; name: string; weeks: number };
type PlanKind = InvitePlan['kind'];
type Item = { key: string; workoutId: string | null; on: IsoDate };

type FieldError = { field: 'firstName' | 'lastName' | 'email'; message: string };
const FIELD_MESSAGES: Record<FieldError['field'], string> = {
  firstName: 'Enter a first name (1 to 100 characters).',
  lastName: 'Last name can be at most 100 characters.',
  email: 'Enter a valid email address.',
};

const PLAN_LABEL: Record<PlanKind, string> = { program: 'Program', workouts: 'Single workout', none: 'Nothing yet' };

/** The Monday after `today` (a week on, when today is a Monday): when most programs start. */
const nextMonday = (today: IsoDate) => addDays(today, 8 - isoWeekday(today));
const expiryFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

type Sent = {
  firstName: string;
  email: string;
  expiresAt: string | null;
  /** Step 3 of "Next steps", or null with nothing planned (or when the plan couldn't be kept). */
  planStep: { lead: string; name: string; rest: string } | null;
  planError: string | null;
  /** Extra word from the send (for example they already train with another coach). */
  note: StatusView | null;
};

/** "+ Invite client" and its window. */
export function InviteClientButton(props: { coachName: string; library: LibraryWorkout[]; programs: Program[]; hints: PickerHints }) {
  const [open, setOpen] = useState(false);
  // A fresh window (empty form) each time it opens.
  const [round, setRound] = useState(0);
  return (
    <>
      <Button
        className={styles.inviteButton}
        onClick={() => {
          setRound((r) => r + 1);
          setOpen(true);
        }}
      >
        + Invite client
      </Button>
      {open ? <InviteDialog key={round} {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InviteDialog({
  coachName,
  library,
  programs,
  hints,
  onClose,
}: {
  coachName: string;
  library: LibraryWorkout[];
  programs: Program[];
  hints: PickerHints;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const completeInvite = useAnalyticsTask('invite_client');
  const browserToday = useBrowserToday();
  const today = browserToday ?? localToday();
  const [tab, setTab] = useState<'one' | 'csv'>('one');
  const [sent, setSent] = useState<Sent | null>(null);
  const [form, setForm] = useState(0); // bumps to clear the form for "Invite another"

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.inviteDialog}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      {sent ? (
        <SentView
          titleId={titleId}
          sent={sent}
          onAnother={() => {
            setSent(null);
            setForm((f) => f + 1);
          }}
          onDone={() => dialogRef.current?.close()}
        />
      ) : (
        <>
          <div className={styles.dialogHeader}>
            <h2 id={titleId} className={styles.inviteTitle}>Invite a client</h2>
            <button type="button" aria-label="Close" className={styles.closeButton} onClick={() => dialogRef.current?.close()}>
              ×
            </button>
          </div>
          <div role="tablist" aria-label="How many" className={styles.segmented}>
            {(['one', 'csv'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`invite-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`invite-panel-${t}`}
                className={styles.segment}
                onClick={() => setTab(t)}
              >
                {t === 'one' ? 'One client' : 'Many (CSV)'}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="invite-panel-one" aria-labelledby="invite-tab-one" hidden={tab !== 'one'} className={styles.tabPanel}>
            <OneClientForm
              key={form}
              today={today}
              coachName={coachName}
              library={library}
              programs={programs}
              hints={hints}
              onCancel={() => dialogRef.current?.close()}
              onSent={(s) => {
                completeInvite();
                track('invite_sent');
                setSent(s);
              }}
            />
          </div>
          <div role="tabpanel" id="invite-panel-csv" aria-labelledby="invite-tab-csv" hidden={tab !== 'csv'} className={styles.tabPanel}>
            <CsvUpload />
          </div>
        </>
      )}
    </dialog>
  );
}

function OneClientForm({
  today,
  coachName,
  library,
  programs,
  hints,
  onCancel,
  onSent,
}: {
  today: IsoDate;
  coachName: string;
  library: LibraryWorkout[];
  programs: Program[];
  hints: PickerHints;
  onCancel: () => void;
  onSent: (sent: Sent) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatusView | null>(null);
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<PlanKind>('none');
  const [programId, setProgramId] = useState(() => programs.find((p) => p.id === hints.lastProgramId)?.id ?? programs[0]?.id ?? '');
  const [startOn, setStartOn] = useState<string>(() => nextMonday(today));
  const [items, setItems] = useState<Item[]>(() => [{ key: 'w0', workoutId: null, on: nextMonday(today) }]);

  const nameOf = (id: string | null) => library.find((w) => w.id === id)?.name ?? '';
  const program = programs.find((p) => p.id === programId) ?? null;
  const chosen = items.filter((i): i is Item & { workoutId: string } => i.workoutId !== null);
  const last = items[items.length - 1]!;

  function buildPlan(): InvitePlan | string {
    if (kind === 'program') {
      if (!program) return 'Pick a program, or choose Nothing yet.';
      if (!IsoDateSchema.safeParse(startOn).success) return 'Pick a start day.';
      return { kind: 'program', programId: program.id, startOn };
    }
    if (kind === 'workouts') {
      if (chosen.length === 0) return 'Pick a workout, or choose Nothing yet.';
      if (chosen.some((i) => !IsoDateSchema.safeParse(i.on).success)) return 'Pick a day for each workout.';
      return { kind: 'workouts', items: chosen.map((i) => ({ workoutId: i.workoutId, on: i.on })) };
    }
    return { kind: 'none' };
  }

  function planStep(plan: InvitePlan): Sent['planStep'] {
    if (plan.kind === 'program' && program) return { lead: 'Their', name: program.name, rest: ` program begins ${formatShortDay(plan.startOn)}` };
    if (plan.kind === 'workouts') {
      const first = plan.items[0]!;
      const more = plan.items.length - 1;
      return { lead: '', name: nameOf(first.workoutId), rest: ` is on their calendar for ${formatShortDay(first.on)}${more > 0 ? ` (and ${more} more)` : ''}` };
    }
    return null;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const parsed = InviteInput.safeParse({ firstName, lastName, email });
    if (!parsed.success) {
      const bad = (['firstName', 'lastName', 'email'] as const).find((f) => parsed.error.issues.some((i) => i.path[0] === f)) ?? 'firstName';
      setFieldError({ field: bad, message: FIELD_MESSAGES[bad] });
      return;
    }
    setFieldError(null);
    const plan = buildPlan();
    if (typeof plan === 'string') return setError(plan);
    const badPlan = invitePlanError(plan, today);
    if (badPlan) return setError(badPlan);

    startTransition(async () => {
      try {
        const outcome = await inviteClient({ invite: parsed.data, plan, today });
        if (!outcome.ok) return setError(outcome.error);
        const { result: r } = outcome;
        if (r.status === 'sent' || r.status === 'resent' || r.status === 'with_another_coach') {
          onSent({
            firstName: parsed.data.firstName,
            email: parsed.data.email,
            expiresAt: outcome.expiresAt,
            planStep: outcome.planError ? null : planStep(plan),
            planError: outcome.planError,
            note: r.status === 'with_another_coach' || r.message ? statusView(r.status, r.message) : null,
          });
          return;
        }
        setResult(statusView(r.status, r.message));
      } catch (e) {
        setError(failureMessage(e, "Couldn't send. Check your connection and try again."));
      }
    });
  }

  const invalid = (name: FieldError['field']) =>
    fieldError?.field === name ? { 'aria-invalid': true, 'aria-describedby': 'invite-field-error' } : {};
  const who = firstName.trim() || 'They';
  const firstChosen = chosen[0];

  return (
    <form onSubmit={onSubmit} className={styles.inviteForm} noValidate>
      <div className={styles.nameGrid}>
        <TextField label="First name" name="firstName" autoComplete="off" value={firstName} onChange={(e) => setFirstName(e.target.value)} {...invalid('firstName')} />
        <TextField label="Last name" name="lastName" autoComplete="off" value={lastName} onChange={(e) => setLastName(e.target.value)} {...invalid('lastName')} />
      </div>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="They'll sign in to the app with this email."
        {...invalid('email')}
      />
      {fieldError ? <ErrorText id="invite-field-error">{fieldError.message}</ErrorText> : null}

      <section className={styles.startBox} aria-labelledby="start-heading">
        <div className={styles.startHeader}>
          <h3 id="start-heading" className={styles.startHeading}>Optional · give them something to start with</h3>
          <div role="group" aria-labelledby="start-heading" className={styles.planToggle}>
            {(['program', 'workouts', 'none'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                className={styles.planOption}
                onClick={() => {
                  setKind(k);
                  setError(null);
                }}
              >
                {PLAN_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {kind === 'program' ? (
          programs.length === 0 ? (
            <div className={styles.startEmpty}>
              <p className={styles.startNote}>You have no programs yet.</p>
              <ButtonLink href="/programs/new" variant="secondary" className={styles.rowButton}>Build a program</ButtonLink>
            </div>
          ) : (
            <>
              <div className={styles.programGrid}>
                <SelectField label="Program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </SelectField>
                <TextField label="Start date" type="date" min={today} value={startOn} onChange={(e) => setStartOn(e.target.value)} />
              </div>
              <p className={styles.startNote}>
                Their first workouts will be waiting when they join. If they join after the start date, the program starts the day they join.
              </p>
            </>
          )
        ) : null}

        {kind === 'workouts' ? (
          <>
            {chosen.length > 0 ? (
              <ul className={styles.chosenList} aria-label="Chosen workouts">
                {items.map((item, index) =>
                  item.workoutId ? (
                    <li key={item.key} className={styles.chosenItem}>
                      <span className={styles.chosenName}>{nameOf(item.workoutId)}</span>
                      <TextField
                        label="Day"
                        aria-label={`Day for ${nameOf(item.workoutId)}`}
                        type="date"
                        min={today}
                        value={item.on}
                        className={styles.chosenDay}
                        onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, on: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        className={styles.inlineAction}
                        aria-label={`Remove ${nameOf(item.workoutId)}`}
                        onClick={() =>
                          setItems((list) => {
                            const next = list.filter((_, i) => i !== index);
                            return next.length > 0 ? next : [{ key: `w${Date.now()}`, workoutId: null, on: item.on }];
                          })
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
            {last.workoutId === null ? (
              <div className={styles.startPicker}>
                <WorkoutChoices
                  library={library}
                  hints={hints}
                  chosenIds={new Set(chosen.map((i) => i.workoutId))}
                  onPick={(w) => {
                    setError(null);
                    setItems((list) => list.map((x, i) => (i === list.length - 1 ? { ...x, workoutId: w.id } : x)));
                  }}
                />
              </div>
            ) : items.length < INVITE_PLAN_MAX_WORKOUTS ? (
              <button
                type="button"
                className={styles.addAnother}
                onClick={() => setItems((list) => [...list, { key: `w${Date.now()}`, workoutId: null, on: addDays(last.on, 1) }])}
              >
                + Add another workout
              </button>
            ) : null}
            {firstChosen ? (
              <p className={styles.startNote}>
                {nameOf(firstChosen.workoutId)} will be on their calendar for {formatShortDay(firstChosen.on)} when they join
                {chosen.length > 1 ? `, with ${chosen.length - 1} more` : ''}.
              </p>
            ) : (
              <p className={styles.startNote}>Pick a workout (Recent and Most used come first), then its day.</p>
            )}
          </>
        ) : null}
      </section>

      <p className={styles.getsLine}>
        <b>What {who} gets:</b> an email &ldquo;{coachName} invited you to CalTracker&rdquo; with a Join button. The link works for 14 days.
      </p>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {result ? <p role="status" className={styles.status}><StatusChip view={result} /></p> : null}

      <div className={styles.inviteActionsRow}>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" pending={pending}>{pending ? 'Sending…' : 'Send invite'}</Button>
      </div>
    </form>
  );
}

function SentView({ titleId, sent, onAnother, onDone }: { titleId: string; sent: Sent; onAnother: () => void; onDone: () => void }) {
  return (
    <div className={styles.sentView}>
      <span aria-hidden="true" className={styles.sentTick}>✓</span>
      <h2 id={titleId} className={styles.inviteTitle}>Invite sent to {sent.firstName}</h2>
      <p className={styles.sentLine}>
        We emailed <b>{sent.email}</b>.
        {sent.expiresAt ? (
          <>
            {' '}The link works until <b>{expiryFormat.format(new Date(sent.expiresAt))}</b>.
          </>
        ) : null}
      </p>
      {sent.note ? <p className={styles.status}><StatusChip view={sent.note} /></p> : null}
      {sent.planError ? <ErrorText>{sent.planError}</ErrorText> : null}
      <div className={styles.nextSteps}>
        <h3 className={styles.startHeading}>Next steps for {sent.firstName}</h3>
        <ol className={styles.stepList}>
          <li>Open the email on their phone and tap <b>Join</b></li>
          <li>Choose a password in the CalTracker app</li>
          {sent.planStep ? (
            <li>
              {sent.planStep.lead ? `${sent.planStep.lead} ` : null}
              <b>{sent.planStep.name}</b>
              {sent.planStep.rest}
            </li>
          ) : null}
        </ol>
      </div>
      <div className={cx(styles.inviteActionsRow, styles.sentActions)}>
        <Button variant="secondary" onClick={onAnother}>Invite another</Button>
        {/* The form is gone, so focus moves to Done (the window stays open until the coach is finished). */}
        <Button autoFocus onClick={onDone}>Done</Button>
      </div>
      <p className={styles.startNote}>
        {sent.firstName} shows on Clients as &ldquo;Invited&rdquo; until they join. You can resend from there.
      </p>
    </div>
  );
}
