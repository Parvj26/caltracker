import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
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
