'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { codeForMessage, formatFullName, InviteInput, invitePlanError, invitedLabel, type ErrorCode, type IsoDate } from '@caltracker/shared';
import { AdaptiveDialog, Button, Chip, ErrorText, notAContact, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { localDateOf } from '@/lib/daily-check';
import type { PickerHints } from '@/lib/picker-hints';
import { changeInviteEmail, renameInvite, updateInvitePlan } from './actions';
import type { DirectoryInvite } from './client-directory';
import { invitePlanText } from './invite-plan-text';
import { InvitePlanStep, useInvitePlan, type LibraryWorkout, type Program } from './invite-plan-step';
import { useResendInvite } from './resend-button';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

export type PlanOptions = { library: LibraryWorkout[]; programs: Program[]; hints: PickerHints };

/**
 * A pending invite, opened from its row: who it's for and what they start with, all editable while they haven't
 * joined. The name saves when the coach leaves the field; a new email needs "Save and resend to …" (a new invite
 * goes to it and the old link stops working); "Change plan" is the invite window's own plan step. An expired link
 * leads with Resend invite. Cancel invite… closes this and asks first (one pop-up at a time).
 */
export function InviteSheet({
  invite,
  today,
  planOptions,
  onMoved,
  onCancelInvite,
  onClose,
}: {
  invite: DirectoryInvite;
  today: IsoDate | null;
  planOptions: PlanOptions;
  /** The invite now has a new id (its email changed). */
  onMoved: (newId: string, email: string) => void;
  /** "Cancel invite…": the list asks "Cancel this invite?" once this has closed. */
  onCancelInvite: () => void;
  onClose: () => void;
}) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [view, setView] = useState<'details' | 'plan'>('details');
  const planFormId = useId();
  // Its step of history keeps the id it opened with (a new email gives the invite a new id while this stays open).
  const [historyId] = useState(() => `invite-${invite.id}`);
  const [planPending, setPlanPending] = useState(false);
  const sentLabel = today ? invitedLabel(localDateOf(invite.sentAt), today) : 'Invited';
  return (
    <AdaptiveDialog
      ref={ref}
      historyId={historyId}
      title={view === 'plan' ? 'Change plan' : invite.name || invite.email}
      subtitle={view === 'plan' ? invite.name : undefined}
      onClose={onClose}
      busy={planPending}
      fullScreenOnPhone={view === 'plan'}
      footer={
        view === 'plan' ? (
          <>
            <Button variant="secondary" onClick={() => setView('details')} disabled={planPending}>
              Cancel
            </Button>
            <Button type="submit" form={planFormId} pending={planPending} data-ph-capture-attribute-label="invite_sheet_save_plan" data-ph-safe="">
              {planPending ? 'Saving…' : 'Save plan'}
            </Button>
          </>
        ) : undefined
      }
    >
      {view === 'plan' ? (
        <ChangePlan formId={planFormId} invite={invite} today={today} planOptions={planOptions} onPending={setPlanPending} onDone={() => setView('details')} />
      ) : (
        <Details
          invite={invite}
          today={today}
          sentLabel={sentLabel}
          onMoved={onMoved}
          onChangePlan={() => setView('plan')}
          onCancelInvite={() => void ref.current?.close().then(onCancelInvite)}
        />
      )}
    </AdaptiveDialog>
  );
}

function Details({
  invite,
  today,
  sentLabel,
  onMoved,
  onChangePlan,
  onCancelInvite,
}: {
  invite: DirectoryInvite;
  today: IsoDate | null;
  sentLabel: string;
  onMoved: (newId: string, email: string) => void;
  onChangePlan: () => void;
  onCancelInvite: () => void;
}) {
  const { resend, pending: resending, message: resendMessage } = useResendInvite(invite);
  const [name, setName] = useState(invite.name);
  const [nameState, setNameState] = useState<'idle' | 'saving' | 'saved' | ErrorCode>('idle');
  const savedName = useRef(invite.name);
  const [email, setEmail] = useState(invite.email);
  const [emailError, setEmailError] = useState<ErrorCode | null>(null);
  const [emailResult, setEmailResult] = useState<StatusView | null>(null);
  const [moving, startMove] = useTransition();
  const planText = invitePlanText(invite.plan) ?? 'Nothing yet';
  const newEmail = email.trim().toLowerCase();
  const emailChanged = newEmail !== '' && newEmail !== invite.email.toLowerCase();

  async function saveName() {
    const typed = name.trim().replace(/\s+/g, ' ');
    if (typed === savedName.current) return;
    setNameState('saving');
    try {
      const outcome = await renameInvite(invite.id, typed);
      if (outcome.ok) {
        savedName.current = typed;
        setNameState('saved');
      } else setNameState(outcome.code);
    } catch (e) {
      setNameState(failureCode(e, 'invite_rename_failed'));
    }
  }

  function saveEmail() {
    setEmailError(null);
    setEmailResult(null);
    const checked = InviteInput.shape.email.safeParse(email);
    if (!checked.success) return setEmailError('invite_email_invalid');
    startMove(async () => {
      try {
        const outcome = await changeInviteEmail({ inviteId: invite.id, email: checked.data, today: today ?? localDateOf(new Date().toISOString()) });
        if (!outcome.ok) return setEmailError(outcome.code);
        const view = statusView(outcome.result.status, outcome.result.message);
        if (outcome.planError) setEmailError(outcome.planError);
        else if (outcome.keptOld === 'plan') setEmailError('invite_email_plan_kept');
        else if (outcome.keptOld === 'lookup' || (outcome.inviteId && !outcome.oldCancelled)) setEmailError('invite_old_link_failed');
        if (outcome.inviteId) {
          setEmailResult(view);
          onMoved(outcome.inviteId, checked.data);
        } else setEmailResult(view);
      } catch (e) {
        setEmailError(failureCode(e, 'invite_send_offline'));
      }
    });
  }

  const resendButton = (primary: boolean) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      onClick={resend}
      pending={resending}
      className={styles.sheetWide}
      data-ph-capture-attribute-label="invite_sheet_resend"
      data-ph-safe=""
    >
      {resending ? 'Sending…' : 'Resend invite'}
    </Button>
  );

  return (
    <div className={styles.inviteSheet}>
      <p className={styles.inviteWaiting}>
        <span aria-hidden="true" className={styles.waitingDot} />
        Waiting for them to join · {sentLabel}
      </p>
      {invite.expired ? (
        <>
          <Chip tone="amber" className={styles.inviteSheetChip}>Link expired</Chip>
          {resendButton(true)}
        </>
      ) : null}
      {resendMessage ? (
        <p role="status" className={styles.status}>
          <StatusChip view={resendMessage} />
        </p>
      ) : null}

      <div className={styles.inviteFields}>
        <TextField
          label="Name"
          {...notAContact('invite-sheet-name')}
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          value={name}
          maxLength={201}
          onChange={(e) => {
            setName(e.target.value);
            if (nameState !== 'saving') setNameState('idle');
          }}
          onBlur={() => void saveName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          {...(nameState === 'saving' ? { hint: 'Saving…' } : nameState === 'saved' ? { hint: 'Saved' } : {})}
          error={nameState !== 'idle' && nameState !== 'saving' && nameState !== 'saved' ? { code: nameState } : undefined}
        />
        <TextField
          label="Email"
          {...notAContact('invite-sheet-email')}
          type="email"
          inputMode="email"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
            setEmailResult(null);
          }}
        />
      </div>
      {emailChanged && !emailResult ? (
        <div className={styles.emailChange}>
          <Button onClick={saveEmail} pending={moving} className={styles.sheetWide} data-ph-capture-attribute-label="invite_sheet_change_email">
            {moving ? 'Sending…' : `Save and resend to ${newEmail}`}
          </Button>
          <p className={styles.startNote}>The old link stops working.</p>
        </div>
      ) : null}
      {emailError ? <ErrorText code={emailError} /> : null}
      {emailResult ? (
        <p role="status" className={styles.status}>
          <StatusChip view={emailResult} />
        </p>
      ) : null}

      <div className={styles.startsWith}>
        <div className={styles.startsWithText}>
          <span className={styles.startHeading}>Starts with</span>
          <span>{planText}</span>
        </div>
        <Button variant="secondary" size="compact" onClick={onChangePlan} data-ph-capture-attribute-label="invite_sheet_change_plan" data-ph-safe="">
          Change plan
        </Button>
      </div>

      {invite.expired ? null : resendButton(false)}

      <div className={styles.inviteSheetEnd}>
        <button type="button" className={styles.dangerLink} onClick={onCancelInvite} data-ph-capture-attribute-label="invite_sheet_cancel" data-ph-safe="">
          Cancel invite…
        </button>
      </div>
    </div>
  );
}

function ChangePlan({
  formId,
  invite,
  today,
  planOptions,
  onPending,
  onDone,
}: {
  formId: string;
  invite: DirectoryInvite;
  today: IsoDate | null;
  planOptions: PlanOptions;
  onPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const day = today ?? localDateOf(new Date().toISOString());
  const plan = useInvitePlan({ today: day, programs: planOptions.programs, hints: planOptions.hints, initial: invite.planDetail });
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const firstName = formatFullName({ firstName: invite.firstName, lastName: '' });
  useEffect(() => {
    onPending(pending);
    // Saved and gone back to the details while still marked busy: not busy any more.
    return () => onPending(false);
  }, [pending, onPending]);

  function save() {
    setError(null);
    const built = plan.build();
    if (typeof built === 'string') return setError(built);
    const bad = invitePlanError(built, day);
    if (bad) return setError(codeForMessage(bad, 'invite_plan_invalid'));
    startTransition(async () => {
      try {
        const outcome = await updateInvitePlan({ inviteId: invite.id, plan: built, today: day });
        if (!outcome.ok) return setError(outcome.code);
        onDone();
      } catch (e) {
        setError(failureCode(e, 'invite_plan_save_failed'));
      }
    });
  }

  return (
    <form
      id={formId}
      className={styles.inviteForm}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <InvitePlanStep
        plan={plan}
        today={day}
        library={planOptions.library}
        programs={planOptions.programs}
        hints={planOptions.hints}
        heading={`Give ${firstName || 'them'} something to start with`}
        onChange={() => setError(null)}
      />
      {error ? <ErrorText code={error} /> : null}
    </form>
  );
}
