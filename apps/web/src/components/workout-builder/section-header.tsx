'use client';

import { useState } from 'react';
import { ErrorText } from '@/components/ui';
import styles from './builder.module.css';

type Props = {
  section: { id: string; name: string };
  /** Position among all sections, to disable the move buttons at the ends. */
  index: number;
  count: number;
  /** True when the section has no exercises yet. */
  empty: boolean;
  errors: readonly string[];
  onRename: (name: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

/**
 * The heading row of a section. The name is an inline text box (styled as the heading); a hidden real heading carries
 * the same text so screen-reader heading navigation works. (Tradeoff: a text box inside an <h2> gets an unreliable
 * accessible name across browsers, so the heading and the box are separate elements that show the same text.) A blank draft is not saved: the last good name stays.
 */
export function SectionHeader({ section, index, count, empty, errors, onRename, onMove, onRemove }: Props) {
  const [draft, setDraft] = useState(section.name);
  const blank = draft.trim() === '';
  return (
    <div role="group" aria-label={`Section ${section.name}`} className={styles.sectionHeader}>
      <div className={styles.sectionRow}>
        <h2 className={styles.visuallyHidden}>{section.name}</h2>
        <input
          type="text"
          // A fixed name: one built from the section's name would change on every keystroke. The group around it says
          // which section this is.
          aria-label="Section name"
          aria-invalid={blank || undefined}
          maxLength={40}
          className={`${styles.input} ${styles.sectionName}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onRename(e.target.value);
          }}
          onBlur={() => setDraft(section.name)}
        />
        <div className={styles.blockTools}>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${section.name} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${section.name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button type="button" className={styles.smallButton} aria-label={`Remove ${section.name}`} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      {blank ? <ErrorText code="field_required">Name the section.</ErrorText> : null}
      {errors.map((m) => (
        <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
      ))}
      {empty ? <p className={styles.caption}>No exercises yet.</p> : null}
    </div>
  );
}
