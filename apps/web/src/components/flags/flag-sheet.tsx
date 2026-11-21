'use client';

import { useId, useRef, useState, useTransition } from 'react';
import {
  BODY_AREAS,
  FLAG_NOTE_MAX_LENGTH,
  FLAG_SIDE_LABELS,
  FLAG_TYPES,
  FLAG_TYPE_LABELS,
  MUSCLE_GROUPS,
  defaultFlagSide,
  flagPlace,
  flagSidesFor,
  isBodyRegionId,
  regionOnView,
  validateFlag,
  type BodyRegionId,
  type BodySide,
  type BodyView,
  type ErrorCode,
  type FlagSide,
  type FlagType,
  type IsoDate,
} from '@caltracker/shared';
import { AdaptiveDialog, Button, ErrorText, SelectField, TextAreaField, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { BodyMap } from '@/components/body-map/body-map';
import { failureCode } from '@/lib/action-errors';
import { addFlag } from '@/app/(coach)/clients/[clientId]/flags-actions';
import { Segmented } from './segmented';
import styles from './flags.module.css';

const GENERAL = 'general';

export type FlagStart = { region: BodyRegionId; side: BodySide | 'none' } | null;

/**
 * "New flag" (board AS9): the body part (tap it on the map, or pick it from the list), Pain / Injury / Limitation,
 * the side, since when and a short note. Opened by "+ Flag" or by tapping a region on the card's map.
 */
export function FlagSheet({
  clientId,
  clientName,
  start,
  today,
  onSaved,
  onClose,
}: {
  clientId: string;
  clientName: string;
  start: FlagStart;
  today: IsoDate;
  onSaved: (place: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const formId = useId();
  const mapNoteId = useId();
  const startRegion = start?.region ?? null;
  const [historyId] = useState(() => `flag-new-${start ? `${start.region}-${start.side}` : 'any'}`);
  const [region, setRegion] = useState<string>(startRegion ?? '');
  const [side, setSide] = useState<FlagSide>(() => defaultFlagSide(startRegion, start && start.side !== 'none' ? start.side : undefined));
  const [type, setType] = useState<FlagType>('pain');
  const [since, setSince] = useState<string>(today);
  const [note, setNote] = useState('');
  const [view, setView] = useState<BodyView>(() => (startRegion && !regionOnView(startRegion, 'front') ? 'back' : 'front'));
  const [fieldError, setFieldError] = useState<{ field: string; error: string } | null>(null);
  const [saveError, setSaveError] = useState<ErrorCode | null>(null);
  const [pending, startSave] = useTransition();

  const regionId = region === '' || region === GENERAL ? null : isBodyRegionId(region) ? region : null;
  const sides = flagSidesFor(regionId);
  const dirty = region !== (startRegion ?? '') || type !== 'pain' || since !== today || note.trim() !== '';

  function pickRegion(id: string, tapped?: BodySide) {
    setRegion(id);
    const r = id === GENERAL || id === '' ? null : isBodyRegionId(id) ? id : null;
    setSide(defaultFlagSide(r, tapped));
    if (r && !regionOnView(r, view)) setView(view === 'front' ? 'back' : 'front');
    setFieldError(null);
  }

  function submit() {
    setSaveError(null);
    if (region === '') return setFieldError({ field: 'region', error: 'Pick a body part.' });
    const input = { region: regionId, side, type, since, note };
    const checked = validateFlag(input, today);
    if (!checked.ok) return setFieldError({ field: checked.field, error: checked.error });
    setFieldError(null);
    startSave(async () => {
      try {
        const outcome = await addFlag(clientId, input, today);
        if (!outcome.ok) return setSaveError(outcome.code);
        // "Left knee flagged.", "Both knees flagged.", "Neck flagged."
        const place = flagPlace({ region: regionId, side });
        await ref.current?.close();
        onSaved(place);
      } catch (e) {
        setSaveError(failureCode(e, 'save_offline'));
      }
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? (
      <ErrorText code="field_format" id={`${formId}-${field}-error`}>
        {fieldError.error}
      </ErrorText>
    ) : null;

  return (
    <AdaptiveDialog
      ref={ref}
      historyId={historyId}
      title="New flag"
      titleSafe
      subtitle={clientName}
      onClose={onClose}
      dirty={dirty}
      discardText="The flag isn’t saved yet."
      busy={pending}
      fullScreenOnPhone
      noKeyboardOnTouch
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button type="submit" form={formId} pending={pending} phSafe data-ph-capture-attribute-label="flag_save">
            {pending ? 'Saving…' : 'Save flag'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.sheetMap}>
          <Segmented
            label="Body view"
            options={[
              { value: 'front', label: 'Front' },
              { value: 'back', label: 'Back' },
            ]}
            value={view}
            onChange={(v) => setView(v as BodyView)}
            compact
          />
          <p id={mapNoteId} className={styles.caption} data-ph-safe="">
            Tap a body part, or pick it from the list. Pinch to zoom for small ones.
          </p>
          <BodyMap
            view={view}
            label={view === 'front' ? 'Front of body: pick a body part' : 'Back of body: pick a body part'}
            size="large"
            areas
            describedBy={mapNoteId}
            selected={regionId ? { id: regionId, side } : null}
            onSelect={(id, s) => pickRegion(id, s === 'none' ? undefined : s)}
          />
        </div>

        <SelectField
          label="Body part"
          value={region}
          onChange={(e) => pickRegion(e.target.value)}
          aria-invalid={fieldError?.field === 'region' ? true : undefined}
          aria-describedby={fieldError?.field === 'region' ? `${formId}-region-error` : undefined}
        >
          <option value="" disabled>
            Pick a body part
          </option>
          <optgroup label="Muscle groups">
            {MUSCLE_GROUPS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Joints">
            {BODY_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
          <option value={GENERAL}>General (no one body part)</option>
        </SelectField>
        {errorFor('region')}

        <Segmented label="Flag" options={FLAG_TYPES.map((t) => ({ value: t, label: FLAG_TYPE_LABELS[t] }))} value={type} onChange={(v) => setType(v as FlagType)} />
        {errorFor('type')}

        {sides.length > 1 ? (
          <Segmented label="Side" options={sides.map((s) => ({ value: s, label: FLAG_SIDE_LABELS[s] }))} value={side} onChange={(v) => setSide(v as FlagSide)} />
        ) : null}
        {errorFor('side')}

        <TextField
          label="Since"
          type="date"
          value={since}
          max={today}
          min="2000-01-01"
          onChange={(e) => setSince(e.target.value)}
          aria-invalid={fieldError?.field === 'since' ? true : undefined}
        />
        {errorFor('since')}

        <TextAreaField
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={FLAG_NOTE_MAX_LENGTH}
          rows={2}
          placeholder="Stiff after desk work"
        />
        {errorFor('note')}
        {saveError ? <ErrorText code={saveError} /> : null}
      </form>
    </AdaptiveDialog>
  );
}
