'use client';

import { useState, type FormEvent } from 'react';
import { BIO_MAX_LENGTH, BUSINESS_NAME_MAX_LENGTH, ProfileInput, characterCount } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { SaveStatus } from '@/components/save-status';
import { Button, ErrorText, SelectField, TextAreaField, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { saveProfile } from './actions';
import styles from './profile.module.css';

type Fields = 'firstName' | 'lastName' | 'businessName' | 'bio';
type Values = { firstName: string; lastName: string; businessName: string; bio: string; units: 'lb' | 'kg' };

/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined) => (message ? { error: message } : {});

/** Photo is handled by AvatarPicker; this form is the names, business, bio and units, with one Save button. */
export function ProfileForm({ initial, email }: { initial: Values; email: string }) {
  const [values, setValues] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
    // Nothing changed: no write, no error, just the tick.
    if (!dirty) {
      setSavedAt(Date.now());
      return;
    }
    setPending(true);
    try {
      const outcome = await saveProfile(parsed.data);
      if (!outcome.ok) {
        // The details were saved but the business rename was refused: the saved state follows what the server kept.
        if (outcome.partial) setSaved({ ...parsed.data, businessName: saved.businessName });
        setFormError(outcome.error);
        return;
      }
      setValues(parsed.data);
      setSaved(parsed.data);
      setSavedAt(Date.now());
    } catch (err) {
      setFormError(failureMessage(err, "Couldn't save. Please try again."));
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
        {errors.bio ? <ErrorText>{errors.bio}</ErrorText> : null}
      </div>
      <SelectField label="Units" value={values.units} onChange={(e) => set('units', e.target.value === 'kg' ? 'kg' : 'lb')}>
        <option value="lb">Pounds (lb)</option>
        <option value="kg">Kilograms (kg)</option>
      </SelectField>
      <TextField label="Email" value={email} readOnly hint="You sign in with this email. Changing it isn't available yet." />

      <div className={styles.actions}>
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <SaveStatus pending={pending} dirty={dirty} everSaved={false} savedAt={savedAt} />
        {formError ? <ErrorText>{formError}</ErrorText> : null}
        {formError === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
      </div>
    </form>
  );
}
