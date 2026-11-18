'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BIO_MAX_LENGTH, BUSINESS_NAME_MAX_LENGTH, ProfileInput, characterCount, codeForMessage, errorMessage, type ErrorCode } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, PhoneActionBar, SelectField, TextAreaField, TextField, errorFromText, type FieldError } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import { saveProfile } from './actions';
import styles from './profile.module.css';

type Fields = 'firstName' | 'lastName' | 'businessName' | 'bio';
type Values = { firstName: string; lastName: string; businessName: string; bio: string; units: 'lb' | 'kg' };

/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined, fallback: ErrorCode = 'field_format') => (message ? { error: errorFromText(message, fallback) } : {});

/**
 * Photo is handled by AvatarPicker; this form is the names, business, bio and units. Save shows only when something
 * changed (UI rules §8): "Unsaved changes" with Save (and Undo) in a bar at the bottom (the phone's action bar, a
 * sticky footer on larger screens); otherwise a quiet "All changes saved". The email is shown as text: it can't be
 * changed here.
 */
export function ProfileForm({ initial, email }: { initial: Values; email: string }) {
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState<FieldError | null>(null);
  const [pending, setPending] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [justSaved, setJustSaved] = useState(0);
  // After a save the bar (and its Save button) goes away: keep the keyboard focus on the form's status instead.
  useEffect(() => {
    if (justSaved > 0) statusRef.current?.focus();
  }, [justSaved]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const dirty = (Object.keys(values) as (keyof Values)[]).some((k) => values[k] !== saved[k]);
  const bioCount = characterCount(values.bio.replace(/\r\n?/g, '\n').trim());
  const bioOver = bioCount > BIO_MAX_LENGTH;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = ProfileInput.safeParse(values);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'firstName' || key === 'lastName' || key === 'businessName' || key === 'bio') && !next[key]) {
          next[key] = key === 'firstName' && values.firstName.trim() === '' ? 'Enter your first name.' : issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (!dirty) return;
    setPending(true);
    try {
      const outcome = await saveProfile(parsed.data);
      if (!outcome.ok) {
        // The details were saved but the business rename was refused: the saved state follows what the server kept.
        if (outcome.partial) setSaved({ ...parsed.data, businessName: saved.businessName });
        setFormError({ code: outcome.code, text: outcome.partial ? `${errorMessage(outcome.code)} Your other changes were saved.` : undefined });
        return;
      }
      setValues(parsed.data);
      setSaved(parsed.data);
      setJustSaved((n) => n + 1);
    } catch (err) {
      setFormError({ code: failureCode(err, 'save_failed') });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.nameRow}>
        <TextField
          label="First name"
          value={values.firstName}
          autoComplete="given-name"
          onChange={(e) => set('firstName', e.target.value)}
          {...errorProp(errors.firstName)}
        />
        <TextField
          label="Last name"
          value={values.lastName}
          autoComplete="family-name"
          onChange={(e) => set('lastName', e.target.value)}
          {...errorProp(errors.lastName)}
        />
      </div>
      <TextField
        label="Business name"
        value={values.businessName}
        hintSafe={false}
        hint={`Clients see "Welcome to ${values.businessName.trim() || 'your business'}". Up to ${BUSINESS_NAME_MAX_LENGTH} characters.`}
        onChange={(e) => set('businessName', e.target.value)}
        {...errorProp(errors.businessName)}
      />
      <div>
        <TextAreaField
          label="Bio"
          value={values.bio}
          rows={4}
          aria-describedby="bio-count"
          aria-invalid={bioOver || undefined}
          onChange={(e) => set('bio', e.target.value)}
        />
        <p id="bio-count" className={cx(styles.counter, bioOver && styles.counterOver)}>
          {bioCount} / {BIO_MAX_LENGTH}
        </p>
        {errors.bio ? <ErrorText code={codeForMessage(errors.bio, 'field_format')}>{errors.bio}</ErrorText> : null}
      </div>
      <SelectField label="Units" value={values.units} onChange={(e) => set('units', e.target.value === 'kg' ? 'kg' : 'lb')}>
        <option value="lb">Pounds (lb)</option>
        <option value="kg">Kilograms (kg)</option>
      </SelectField>
      <div className={styles.readOnly}>
        <p className={styles.readOnlyLabel}>Email</p>
        <p className={styles.readOnlyValue} data-testid="profile-email">
          {email}
        </p>
        <p className={styles.hint}>You sign in with this email. Changing it isn&apos;t available yet.</p>
      </div>

      {formError ? <ErrorText code={formError.code}>{formError.text}</ErrorText> : null}
      {formError?.code === 'stale_deploy' ? <ReloadButton className={styles.smallButton} /> : null}
      {dirty || pending ? (
        <PhoneActionBar status={pending ? 'Saving…' : 'Unsaved changes'} label="Profile actions">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setValues(saved);
              setErrors({});
              setFormError(null);
            }}
            phSafe
          >
            Undo
          </Button>
          <Button type="submit" pending={pending} phSafe>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </PhoneActionBar>
      ) : (
        <p ref={statusRef} tabIndex={-1} role="status" className={styles.savedStatus}>
          All changes saved
        </p>
      )}
    </form>
  );
}
