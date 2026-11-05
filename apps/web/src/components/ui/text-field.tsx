import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

/** Error message: ink text with a magenta warning marker, so colour is never the only signal. */
export function ErrorText({ children, className, id }: { children: ReactNode; className?: string | undefined; id?: string | undefined }) {
  return (
    <p role="alert" id={id} className={cx(styles.errorText, className)}>
      <span aria-hidden="true" className={styles.errorMarker}>⚠</span>
      <span>{children}</span>
    </p>
  );
}

export function TextField({ label, error, hint, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText}>{label}</span>
        <input
          {...rest}
          id={inputId}
          aria-invalid={error ? true : rest['aria-invalid']}
          aria-describedby={describedBy}
          className={styles.input}
        />
      </label>
      {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
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
        <span className={styles.fieldLabelText}>{label}</span>
        <select {...rest} aria-describedby={hint ? hintId : undefined} className={cx(styles.input, styles.select)}>
          {children}
        </select>
      </label>
      {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

/** Multi-line text field styled like TextField. */
export function TextAreaField({ label, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps) {
  const hintId = `${useId()}-hint`;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText}>{label}</span>
        <textarea {...rest} aria-describedby={hint ? hintId : undefined} className={cx(styles.input, styles.textarea)} />
      </label>
      {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
