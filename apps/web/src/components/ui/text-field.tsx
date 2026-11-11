import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { codeForMessage, errorMessage, type ErrorCode } from '@caltracker/shared';
import { cx } from './cx';
import styles from './ui.module.css';

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** The error under the field: its code, and optional fixed copy to show instead of the catalogue message. */
  error?: FieldError | undefined;
  hint?: string;
  /** Pass false when the hint can show something the user typed (it then stays hidden in recordings). */
  hintSafe?: boolean;
  /** Pass false when the label can show something the user typed (a custom measure's name). */
  labelSafe?: boolean;
};

export type FieldError = {
  code: ErrorCode;
  text?: string | undefined;
  /** False when `text` quotes something the user typed (a custom measure's name): it then stays hidden in recordings. */
  safe?: boolean | undefined;
};

/**
 * A field error from a fixed message our own validators return (date rules, schema messages): its code when the
 * message is in the error-code list, else `fallback`, keeping the exact wording. Never pass typed or server text.
 */
export const errorFromText = (text: string, fallback: ErrorCode): FieldError => ({ code: codeForMessage(text, fallback), text });

export type ErrorTextProps = {
  /** Which error this is (sent with `error_shown`); shows the catalogue message unless `children` is given. */
  code: ErrorCode;
  /** Fixed product copy only: never a server/database message or anything the user typed. */
  children?: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
  /** False only when `children` quotes something the user typed; the code is still sent, the text stays hidden. */
  safe?: boolean | undefined;
};

/**
 * The only place that renders `role="alert"` (lint enforces it). Error message: ink text with a
 * magenta warning marker, so colour is never the only signal. Its text is fixed copy, so it is safe to
 * show in session recordings.
 */
export function ErrorText({ code, children, className, id, safe = true }: ErrorTextProps) {
  return (
    <p role="alert" id={id} data-error-code={code} {...(safe ? { 'data-ph-safe': '' } : {})} className={cx(styles.errorText, className)}>
      <span aria-hidden="true" className={styles.errorMarker}>⚠</span>
      <span>{children ?? errorMessage(code)}</span>
    </p>
  );
}

export function TextField({ label, error, hint, hintSafe = true, labelSafe = true, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText} {...(labelSafe ? { 'data-ph-safe': '' } : {})}>{label}</span>
        <input
          {...rest}
          id={inputId}
          aria-invalid={error ? true : rest['aria-invalid']}
          aria-describedby={describedBy}
          className={styles.input}
        />
      </label>
      {hint ? <p id={hintId} className={styles.hint} {...(hintSafe ? { 'data-ph-safe': '' } : {})}>{hint}</p> : null}
      {error ? (
        <ErrorText id={errorId} code={error.code} safe={error.safe}>
          {error.text}
        </ErrorText>
      ) : null}
    </div>
  );
}

type ControlProps = { label: string; hint?: string };

/** Native select styled like TextField. */
export function SelectField({ label, hint, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & ControlProps) {
  const hintId = `${useId()}-hint`;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText} data-ph-safe="">{label}</span>
        <select {...rest} aria-describedby={hint ? hintId : undefined} className={cx(styles.input, styles.select)}>
          {children}
        </select>
      </label>
      {hint ? <p id={hintId} className={styles.hint} data-ph-safe="">{hint}</p> : null}
    </div>
  );
}

/** Multi-line text field styled like TextField. */
export function TextAreaField({ label, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps) {
  const hintId = `${useId()}-hint`;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText} data-ph-safe="">{label}</span>
        <textarea {...rest} aria-describedby={hint ? hintId : undefined} className={cx(styles.input, styles.textarea)} />
      </label>
      {hint ? <p id={hintId} className={styles.hint} data-ph-safe="">{hint}</p> : null}
    </div>
  );
}
