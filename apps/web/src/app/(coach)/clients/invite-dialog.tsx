'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  INVITE_PLAN_MAX_WORKOUTS,
  InviteInput,
  IsoDateSchema,
  addDays,
  codeForMessage,
  invitePlanError,
  isoWeekday,
  localToday,
  type ErrorCode,
  type InvitePlan,
  type IsoDate,
} from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { AdaptiveDialog, Button, ButtonLink, ErrorText, notAContact, SelectField, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { useBrowserToday } from '@/lib/local-today';
import type { PickerHints } from '@/lib/picker-hints';
import { inviteClient } from './actions';
import { CsvUpload } from './csv-upload';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';
import { track } from '@/lib/analytics/client';
import { useSheetOnLoad } from '@/lib/use-sheet-on-load';

type LibraryWorkout = { id: string; name: string };
type Program = { id: string; name: string; weeks: number };
type PlanKind = InvitePlan['kind'];
type Item = { key: string; workoutId: string | null; on: IsoDate };

type FieldError = { field: 'firstName' | 'lastName' | 'email'; code: ErrorCode };
const FIELD_CODES: Record<FieldError['field'], ErrorCode> = {
  firstName: 'invite_first_name_invalid',
  lastName: 'invite_last_name_invalid',
  email: 'invite_email_invalid',
};
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
  planError: ErrorCode | null;
  /** Extra word from the send (for example they already train with another coach). */
  note: StatusView | null;
};

/** Sent on window once the invite window has closed (and its step of history is gone). */
export const INVITE_CLOSED_EVENT = 'caltracker:invite-closed';

/** "+ Invite client" and its window. */
export function InviteClientButton(props: { coachName: string; library: LibraryWorkout[]; programs: Program[]; hints: PickerHints }) {
  const [open, setOpen] = useState(false);
  // A fresh window (empty form) each time it opens.
  const [round, setRound] = useState(0);
  // A refresh or shared link with ?sheet=invite opens the window again (UI rules §8.3).
  useSheetOnLoad((id) => {
    if (id !== 'invite') return false;
    setRound((r) => r + 1);
    setOpen(true);
    return true;
  });
  return (
    <>
      {/* The page's create button (lime, UI rules §4). On a phone it reads "+ Invite". */}
      <Button
        variant="create"
        className={styles.inviteButton}
        aria-label="Invite client"
        data-ph-capture-attribute-label="invite_open"
        data-ph-safe=""
        onClick={() => {
          setRound((r) => r + 1);
          setOpen(true);
        }}
      >
        + Invite<span className={styles.inviteWord}> client</span>
      </Button>
      {open ? (
        <InviteDialog
          key={round}
          {...props}
          onClose={() => {
            setOpen(false);
            // The window's step of history is gone by now; the list may switch to Invited (client-directory.tsx).
            setTimeout(() => window.dispatchEvent(new Event(INVITE_CLOSED_EVENT)), 0);
          }}
        />
      ) : null}
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
  const ref = useRef<AdaptiveDialogHandle>(null);
  const formId = useId();
  const completeInvite = useAnalyticsTask('invite_client');
  const browserToday = useBrowserToday();
  const today = browserToday ?? localToday();
  const [tab, setTab] = useState<'one' | 'csv'>('one');
  const [sent, setSent] = useState<Sent | null>(null);
  const [form, setForm] = useState(0); // bumps to clear the form for "Invite another"
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);

  // The Sent view is much shorter than the form, so start it at the top (its tick and title). Also for "Invite another".
  useEffect(() => {
    document.querySelector('[data-invite-body]')?.parentElement?.scrollTo({ top: 0 });
  }, [sent]);

  const close = () => ref.current?.requestClose();
  return (
    <AdaptiveDialog
      ref={ref}
      historyId="invite"
      title={sent ? `Invite sent to ${sent.firstName}` : 'Invite a client'}
      titleSafe={!sent}
      onClose={onClose}
      dirty={!sent && tab === 'one' && dirty}
      busy={pending}
      fullScreenOnPhone={!sent}
      footer={
        sent ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setSent(null);
                setDirty(false);
                setForm((f) => f + 1);
              }}
            >
              Invite another
            </Button>
            {/* The form is gone, so focus moves to Done (the window stays open until the coach is finished). */}
            <Button autoFocus onClick={() => void ref.current?.close()}>Done</Button>
          </>
        ) : tab === 'one' ? (
          <>
            <Button variant="secondary" onClick={close} disabled={pending} data-ph-capture-attribute-label="invite_cancel" data-ph-safe="">Cancel</Button>
            <Button type="submit" form={formId} pending={pending} data-ph-capture-attribute-label="invite_send" data-ph-safe="">{pending ? 'Sending…' : 'Send invite'}</Button>
          </>
        ) : undefined
      }
    >
      <div data-invite-body="" className={styles.inviteBody}>
        {sent ? (
          <SentView sent={sent} />
        ) : (
          <>
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
                  data-ph-capture-attribute-label={t === 'csv' ? 'invite_csv_open' : 'invite_one_open'}
                  data-ph-safe=""
                  onClick={() => setTab(t)}
                >
                  {t === 'one' ? 'One client' : 'Many (CSV)'}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="invite-panel-one" aria-labelledby="invite-tab-one" hidden={tab !== 'one'} className={styles.tabPanel}>
              <OneClientForm
                key={form}
                formId={formId}
                today={today}
                coachName={coachName}
                library={library}
                programs={programs}
                hints={hints}
                onDirty={setDirty}
                onPending={setPending}
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
      </div>
    </AdaptiveDialog>
  );
}

function OneClientForm({
  formId,
  today,
  coachName,
  library,
  programs,
  hints,
  onDirty,
  onPending,
  onSent,
}: {
  formId: string;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
  today: IsoDate;
  coachName: string;
  library: LibraryWorkout[];
  programs: Program[];
  hints: PickerHints;
  onSent: (sent: Sent) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [result, setResult] = useState<StatusView | null>(null);
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<PlanKind>('none');
  const [programId, setProgramId] = useState(() => programs.find((p) => p.id === hints.lastProgramId)?.id ?? programs[0]?.id ?? '');
  const [startOn, setStartOn] = useState<string>(() => nextMonday(today));
  const [items, setItems] = useState<Item[]>(() => [{ key: 'w0', workoutId: null, on: nextMonday(today) }]);
  // Something typed or picked: closing asks "Discard changes?" first.
  const dirty = firstName !== '' || lastName !== '' || email !== '' || kind !== 'none';
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => onPending(pending), [pending, onPending]);

  const nameOf = (id: string | null) => library.find((w) => w.id === id)?.name ?? '';
  const program = programs.find((p) => p.id === programId) ?? null;
  const chosen = items.filter((i): i is Item & { workoutId: string } => i.workoutId !== null);
  const last = items[items.length - 1]!;

  function buildPlan(): InvitePlan | ErrorCode {
    if (kind === 'program') {
      if (!program) return 'invite_plan_no_program';
      if (!IsoDateSchema.safeParse(startOn).success) return 'invite_plan_no_start';
      return { kind: 'program', programId: program.id, startOn };
    }
    if (kind === 'workouts') {
      if (chosen.length === 0) return 'invite_plan_no_workout';
      if (chosen.some((i) => !IsoDateSchema.safeParse(i.on).success)) return 'invite_plan_no_day';
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
      setFieldError({ field: bad, code: FIELD_CODES[bad] });
      return;
    }
    setFieldError(null);
    const plan = buildPlan();
    if (typeof plan === 'string') return setError(plan);
    const badPlan = invitePlanError(plan, today);
    if (badPlan) return setError(codeForMessage(badPlan, 'invite_plan_invalid'));

    startTransition(async () => {
      try {
        const outcome = await inviteClient({ invite: parsed.data, plan, today });
        if (!outcome.ok) return setError(outcome.code);
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
        setError(failureCode(e, 'invite_send_offline'));
      }
    });
  }

  const invalid = (name: FieldError['field']) =>
    fieldError?.field === name ? { 'aria-invalid': true, 'aria-describedby': 'invite-field-error' } : {};
  // "What Ana gets:" once a first name is typed, "What they get:" before.
  const getsLead = firstName.trim() ? `What ${firstName.trim()} gets:` : 'What they get:';
  const firstChosen = chosen[0];

  return (
    <form id={formId} onSubmit={onSubmit} className={styles.inviteForm} noValidate>
      <div className={styles.nameGrid}>
        {/* Someone else's details, not the coach's: no contact AutoFill, spell-check or autocorrect on names. Safari
            ignores autocomplete="off", so notAContact gives each field a name with "search" in it, which keeps the
            contact card away; the form reads React state, not form data. */}
        <TextField
          label="First name"
          {...notAContact('invite-first')}
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          {...invalid('firstName')}
        />
        <TextField
          label="Last name"
          {...notAContact('invite-last')}
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          {...invalid('lastName')}
        />
      </div>
      <TextField
        label="Email"
        {...notAContact('invite-email')}
        type="email"
        inputMode="email"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="They'll sign in to the app with this email."
        {...invalid('email')}
      />
      {fieldError ? (
        <ErrorText id="invite-field-error" code={fieldError.code}>
          {FIELD_MESSAGES[fieldError.field]}
        </ErrorText>
      ) : null}

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
                      <Button
                        variant="quiet"
                        size="compact"
                        className={styles.chosenRemove}
                        aria-label={`Remove ${nameOf(item.workoutId)}`}
                        onClick={() =>
                          setItems((list) => {
                            const next = list.filter((_, i) => i !== index);
                            return next.length > 0 ? next : [{ key: `w${Date.now()}`, workoutId: null, on: item.on }];
                          })
                        }
                      >
                        Remove
                      </Button>
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
        <b>{getsLead}</b> an email &ldquo;{coachName} invited you to CalTracker&rdquo; with a Join button. The link works for 14 days.
      </p>

      {error ? <ErrorText code={error} /> : null}
      {result ? <p role="status" className={styles.status}><StatusChip view={result} /></p> : null}
    </form>
  );
}

function SentView({ sent }: { sent: Sent }) {
  return (
    <div className={styles.sentView}>
      <span aria-hidden="true" className={styles.sentTick}>✓</span>
      <p className={styles.sentLine}>
        We emailed <b>{sent.email}</b>.
        {sent.expiresAt ? (
          <>
            {' '}The link works until <b>{expiryFormat.format(new Date(sent.expiresAt))}</b>.
          </>
        ) : null}
      </p>
      {sent.note ? <p className={styles.status}><StatusChip view={sent.note} /></p> : null}
      {sent.planError ? <ErrorText code={sent.planError} /> : null}
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
      <p className={styles.startNote}>
        {sent.firstName} shows on Clients as &ldquo;Invited&rdquo; until they join. You can resend from there.
      </p>
    </div>
  );
}
