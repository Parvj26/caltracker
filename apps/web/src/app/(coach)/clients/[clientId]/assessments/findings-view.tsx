'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MUSCLE_GROUPS,
  SLOT_LABELS,
  alsoChecks,
  alsoConsider,
  findingChips,
  isMuscleId,
  markKey,
  observedFindings,
  regionSideLabel,
  regionSideName,
  regionSides,
  reviewGroups,
  reviewRows,
  suggestFromFindings,
  type AlsoCheckId,
  type BodyRegionId,
  type ErrorCode,
  type MarkSide,
  type MarkStatus,
  type MuscleId,
  type ReviewGroup,
  type ReviewRow,
  type StoredMark,
} from '@caltracker/shared';
import { FindingsMap } from '@/components/assessment-findings/findings-map';
import { MarkChip } from '@/components/assessment-findings/labels';
import type { RegionSide } from '@/components/body-map/state';
import { ReloadButton } from '@/components/reload-button';
import { AdaptiveDialog, Button, ErrorText, PhoneActionBar, SelectField, type AdaptiveDialogHandle } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import calendar from '@/components/calendar/calendar.module.css';
import { saveAssessmentReview } from './actions';
import type { AssessmentDetail } from './load';
import base from './assessments.module.css';
import styles from './findings.module.css';

const AUTOSAVE_MS = 600;
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; code: ErrorCode };

const STATUS_WORDS: Record<MarkStatus, string> = { over: 'Possibly overactive', under: 'Possibly underactive', normal: 'Normal' };
const SECTION: Record<MarkStatus, string> = {
  over: 'Suspected · possibly overactive',
  under: 'Suspected · possibly underactive',
  normal: 'Checked · normal',
};

/**
 * Findings (board AS4), after the last test. "Observed" is only what the coach tapped; "Suspected" is the app's guess
 * at possible contributors (FINDING_RULES), each with the finding it came from. Per side the coach confirms (✓) or
 * rejects (×) a suggestion, Change picks Over / Under / Normal, and the body map or "+ Add muscle" adds a mark by hand.
 * Only confirmed sides colour the map. Every change saves as a draft a moment later. A finished assessment shows the
 * same screen read-only (its findings are locked with it).
 */
export function FindingsView({
  client,
  assessment,
  initialMarks,
  initialChecks,
  labels,
  editable,
}: {
  client: { id: string; name: string };
  assessment: AssessmentDetail;
  initialMarks: StoredMark[];
  initialChecks: AlsoCheckId[];
  labels: Record<string, string>;
  editable: boolean;
}) {
  const router = useRouter();
  const [marks, setMarksState] = useState<StoredMark[]>(initialMarks);
  const [checks, setChecksState] = useState<AlsoCheckId[]>(initialChecks);
  const latest = useRef({ marks: initialMarks, checks: initialChecks });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [picking, setPicking] = useState<{ id: MuscleId; side: MarkSide } | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const inputs = useMemo(() => assessment.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results })), [assessment.tests]);
  const findings = useMemo(() => observedFindings(inputs), [inputs]);
  const suggested = useMemo(() => suggestFromFindings(findings), [findings]);
  const rows = useMemo(() => reviewRows(suggested, marks, labels), [suggested, marks, labels]);
  const groups = useMemo(() => reviewGroups(rows), [rows]);
  const checkList = useMemo(() => alsoChecks(findings), [findings]);
  const consider = useMemo(() => alsoConsider(findings), [findings]);
  const states = useMemo(() => {
    const out: Record<string, MarkStatus> = {};
    for (const r of rows) if (r.review === 'confirmed') out[markKey(r.muscleId, r.side)] = r.status;
    return out;
  }, [rows]);
  const testsDone = assessment.tests.filter((t) => t.entry.status === 'done' || t.entry.status === 'stopped').length;
  const pending = rows.filter((r) => r.review === 'pending');

  const persist = useCallback((): Promise<boolean> => {
    chain.current = chain.current.then(async () => {
      if (!dirty.current) return true;
      dirty.current = false;
      setSave({ kind: 'saving' });
      try {
        const outcome = await saveAssessmentReview(assessment.id, latest.current.marks, latest.current.checks);
        if (!outcome.ok) {
          setSave({ kind: 'error', code: outcome.code });
          return false;
        }
        setSave({ kind: 'saved' });
        return true;
      } catch (e) {
        setSave({ kind: 'error', code: failureCode(e, 'assessment_save_failed') });
        return false;
      }
    });
    return chain.current;
  }, [assessment.id]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return persist();
  }, [persist]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(nextMarks: StoredMark[], nextChecks: AlsoCheckId[] = latest.current.checks) {
    latest.current = { marks: nextMarks, checks: nextChecks };
    setMarksState(nextMarks);
    setChecksState(nextChecks);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }

  /** Sets (or with null clears) the coach's mark on one muscle and side. */
  function setMarks(changes: { muscleId: MuscleId; side: MarkSide; mark: Omit<StoredMark, 'muscleId' | 'side'> | null }[]) {
    let next = latest.current.marks;
    for (const c of changes) {
      next = next.filter((m) => !(m.muscleId === c.muscleId && m.side === c.side));
      if (c.mark) next = [...next, { muscleId: c.muscleId, side: c.side, ...c.mark }];
    }
    commit(next);
  }

  const ids = (r: Pick<ReviewRow, 'sources'>) => r.sources.map((s) => s.checkpointId);
  const rowAt = (id: MuscleId, side: MarkSide) => rows.find((r) => r.muscleId === id && r.side === side);

  function review(r: ReviewRow, decision: 'confirmed' | 'rejected') {
    // Tapping the chosen one again takes the decision back (a suggestion goes back to waiting; one the coach added
    // goes away).
    if (r.review === decision || (r.origin === 'coach' && decision === 'rejected')) {
      setMarks([{ muscleId: r.muscleId, side: r.side, mark: null }]);
      return;
    }
    setMarks([{ muscleId: r.muscleId, side: r.side, mark: { status: r.status, review: decision, sources: ids(r) } }]);
  }

  function change(g: ReviewGroup, status: MarkStatus) {
    setChanging(null);
    setMarks(g.rows.map((r) => ({ muscleId: r.muscleId, side: r.side, mark: { status, review: 'confirmed' as const, sources: ids(r) } })));
  }

  function confirmAll() {
    setMarks(pending.map((r) => ({ muscleId: r.muscleId, side: r.side, mark: { status: r.status, review: 'confirmed' as const, sources: ids(r) } })));
  }

  function pickFromMap(id: BodyRegionId, side: RegionSide) {
    if (!isMuscleId(id)) return;
    setPicking({ id, side });
  }

  function choose(status: MarkStatus | null) {
    if (!picking) return;
    const r = rowAt(picking.id, picking.side);
    setMarks([{ muscleId: picking.id, side: picking.side, mark: status ? { status, review: 'confirmed', sources: r ? ids(r) : [] } : null }]);
    setPicking(null);
  }

  function toggleCheck(id: AlsoCheckId) {
    const next = latest.current.checks.includes(id) ? latest.current.checks.filter((c) => c !== id) : [...latest.current.checks, id];
    commit(latest.current.marks, next);
  }

  const lastTest = Math.max(1, assessment.tests.length);
  async function back() {
    await flush();
    router.push(editable ? `/clients/${client.id}/assessments/${assessment.id}?test=${lastTest}` : `/clients/${client.id}/assessments/${assessment.id}`);
  }
  async function next() {
    if (moving) return;
    setMoving(true);
    try {
      if (!(await flush())) return;
      router.push(`/clients/${client.id}/assessments/${assessment.id}/exercises`);
    } finally {
      setMoving(false);
    }
  }
  async function close() {
    await flush();
    router.push(`/clients/${client.id}/limitations`);
  }

  const status = save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'Draft saved' : null;
  const pickedRow = picking ? rowAt(picking.id, picking.side) : undefined;
  const pickedState: MarkStatus | null = pickedRow && pickedRow.review === 'confirmed' ? pickedRow.status : null;

  const observed = (
    <section className={styles.block} aria-labelledby="observed-h">
      <h2 id="observed-h" className={base.kicker}>Observed · {testsDone} {testsDone === 1 ? 'test' : 'tests'}</h2>
      {findings.length === 0 ? (
        <p className={base.caption}>Nothing seen: every checkpoint was Normal.</p>
      ) : (
        <ul className={base.findings} aria-label="Observed">
          {findings.map((f) => (
            <li key={`${f.testKey}-${f.checkpointId}`} className={base.finding}>
              <span className={base.findingLabel} data-ph-safe="">{f.label}</span>
              <span className={base.findingChips}>
                {findingChips(f).map((c) => (
                  <span key={c.text} className={base.sevChip} data-severity={c.severity} data-ph-safe="">{c.text}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const also = checkList.length > 0 || consider.length > 0 ? (
    <section className={styles.block} aria-labelledby="also-h">
      <h2 id="also-h" className={base.kicker}>Also check</h2>
      <ul className={styles.checks}>
        {checkList.map((c) => (
          <li key={c.id}>
            <label className={styles.checkRow}>
              <input type="checkbox" className={styles.checkbox} checked={checks.includes(c.id)} disabled={!editable} onChange={() => toggleCheck(c.id)} />
              <span className={styles.checkText}>
                <span className={styles.checkName} data-ph-safe="">{c.label}</span>
                <span className={base.caption} data-ph-safe="">from {c.from.join(', ')}</span>
              </span>
            </label>
          </li>
        ))}
        {consider.map((c) => (
          <li key={c.label} className={styles.considerRow}>
            <span className={styles.checkName} data-ph-safe="">{c.label}</span>
            <span className={base.caption} data-ph-safe="">not on the map · from {c.from.join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  const suspected = (
    <section className={styles.block} aria-label="Suspected">
      <div className={styles.suspectHead}>
        {editable && pending.length > 1 ? (
          <Button variant="quiet" size="compact" onClick={confirmAll} phSafe>
            Confirm all {pending.length}
          </Button>
        ) : null}
        {editable ? (
          <Button variant="secondary" size="compact" onClick={() => setAdding(true)} phSafe>
            + Add muscle
          </Button>
        ) : null}
      </div>
      {groups.length === 0 ? <p className={base.caption}>No muscles suggested. Add one from the map or with “+ Add muscle”.</p> : null}
      {(['over', 'under', 'normal'] as const).map((s) => {
        const list = groups.filter((g) => g.status === s);
        if (list.length === 0) return null;
        return (
          <div key={s} className={styles.section}>
            <h2 className={base.kicker}>{SECTION[s]}</h2>
            <ul className={styles.groups}>
              {list.map((g) => (
                <GroupRow
                  key={`${g.muscleId}|${g.status}`}
                  group={g}
                  editable={editable}
                  changing={changing === `${g.muscleId}|${g.status}`}
                  onChangeOpen={() => setChanging((c) => (c === `${g.muscleId}|${g.status}` ? null : `${g.muscleId}|${g.status}`))}
                  onChange={(st) => change(g, st)}
                  onReview={review}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );

  const map = (
    <FindingsMap states={states} {...(editable ? { onSelect: pickFromMap } : {})} selected={picking} size="large">
      {picking && editable ? (
        <div className={styles.picker} role="group" aria-label={`${regionSideName(picking.id, picking.side)}: choose`} data-testid="map-picker">
          <div className={styles.pickerHead}>
            <strong data-ph-safe="">{regionSideLabel(picking.id, picking.side)}</strong>
            <button type="button" className={styles.pickerClose} aria-label="Close" onClick={() => setPicking(null)}>×</button>
          </div>
          {(['over', 'under', 'normal'] as const).map((st) => (
            <button key={st} type="button" className={styles.pickerOption} aria-pressed={pickedState === st} onClick={() => choose(st)}>
              <MarkChip status={st} />
              <span>{STATUS_WORDS[st]}</span>
            </button>
          ))}
          <button type="button" className={cx(styles.pickerOption, styles.pickerClear)} onClick={() => choose(null)}>
            Clear
          </button>
        </div>
      ) : null}
    </FindingsMap>
  );

  return (
    <div className={styles.page} data-testid="assessment-findings">
      <header className={base.runHead}>
        <div>
          <p className={base.caption}>
            <span data-ph-safe="">{client.name}</span> · {SLOT_LABELS[assessment.slot]} · after {testsDone} {testsDone === 1 ? 'test' : 'tests'}
          </p>
          <h1 className={base.runTitle}>Findings</h1>
        </div>
        <button type="button" className={base.close} aria-label={editable ? 'Close (your draft is kept)' : 'Close'} onClick={() => void close()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      {!editable ? <p className={styles.lockedNote}>This assessment is finished, so its findings are locked.</p> : null}

      <div className={styles.tabs} role="group" aria-label="Show">
        <button type="button" className={base.segment} aria-pressed={tab === 'list'} onClick={() => setTab('list')}>List</button>
        <button type="button" className={base.segment} aria-pressed={tab === 'map'} onClick={() => setTab('map')}>Body map</button>
      </div>

      <div className={styles.layout} data-tab={tab}>
        <div className={styles.colObserved}>{observed}</div>
        <div className={styles.colSuspected}>{suspected}</div>
        {also ? <div className={styles.colAlso}>{also}</div> : null}
        <div className={styles.colMap}>{map}</div>
      </div>

      {save.kind === 'error' ? (
        <div className={base.saveError}>
          <ErrorText code={save.code} />
          {save.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
        </div>
      ) : null}
      <PhoneActionBar status={status ? <span className={base.statusOk}>{status}</span> : undefined} label="Findings actions">
        <Button variant="secondary" className={styles.backButton} onClick={() => void back()} phSafe>Back</Button>
        <Button onClick={() => void next()} pending={moving} phSafe data-testid="pick-exercises">
          {editable ? 'Pick exercises' : 'Exercises'}
        </Button>
      </PhoneActionBar>

      {adding ? (
        <AddMuscleDialog
          findings={findings.map((f) => ({ checkpointId: f.checkpointId, label: f.label }))}
          onAdd={(muscleId, sides, st, source) => {
            setAdding(false);
            setMarks(sides.map((side) => ({ muscleId, side, mark: { status: st, review: 'confirmed' as const, sources: source ? [source] : [] } })));
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

const SIDE_WORD: Record<MarkSide, string> = { L: 'left', R: 'right', none: '' };

function GroupRow({
  group: g,
  editable,
  changing,
  onChangeOpen,
  onChange,
  onReview,
}: {
  group: ReviewGroup;
  editable: boolean;
  changing: boolean;
  onChangeOpen: () => void;
  onChange: (s: MarkStatus) => void;
  onReview: (r: ReviewRow, d: 'confirmed' | 'rejected') => void;
}) {
  const name = regionSideLabel(g.muscleId, 'none');
  return (
    <li className={styles.group} data-testid={`mark-${g.muscleId}-${g.status}`}>
      <div className={styles.groupHead}>
        <div className={styles.groupTitle}>
          <span className={styles.groupName} data-ph-safe="">{name}</span>
          <MarkChip status={g.status} />
        </div>
        {editable ? (
          <Button variant="quiet" size="compact" onClick={onChangeOpen} aria-expanded={changing} aria-label={`Change ${name}`}>
            Change
          </Button>
        ) : null}
      </div>
      {g.sources.length > 0 ? <p className={styles.from} data-ph-safe="">from {g.sources.map((s) => s.label).join(', ')}</p> : <p className={styles.from}>added by you</p>}
      {g.against.length > 0 ? <p className={styles.from} data-ph-safe="">Mixed: {g.against.map((s) => s.label).join(', ')} pointed the other way</p> : null}
      {changing ? (
        <div className={styles.changeMenu} role="group" aria-label={`${name}: change to`}>
          {(['over', 'under', 'normal'] as const).map((st) => (
            <button key={st} type="button" className={styles.pickerOption} aria-pressed={g.status === st && g.rows.every((r) => r.review === 'confirmed')} onClick={() => onChange(st)}>
              <MarkChip status={st} />
              <span>{STATUS_WORDS[st]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.sides}>
        {g.rows.map((r) => (
          <div key={r.side} className={styles.side} data-review={r.review}>
            {r.side !== 'none' ? <span className={styles.sideLetter}>{r.side}</span> : null}
            {editable ? (
              <>
                <button
                  type="button"
                  className={styles.decide}
                  data-kind="confirm"
                  aria-pressed={r.review === 'confirmed'}
                  aria-label={`Confirm ${SIDE_WORD[r.side]} ${name}`.replace('  ', ' ')}
                  onClick={() => onReview(r, 'confirmed')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </button>
                <button
                  type="button"
                  className={styles.decide}
                  data-kind="reject"
                  aria-pressed={r.review === 'rejected'}
                  aria-label={`${r.origin === 'coach' ? 'Remove' : 'Reject'} ${SIDE_WORD[r.side]} ${name}`.replace('  ', ' ')}
                  onClick={() => onReview(r, 'rejected')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </>
            ) : (
              <span className={styles.reviewWord}>{r.review === 'confirmed' ? 'Confirmed' : r.review === 'rejected' ? 'Rejected' : 'Not reviewed'}</span>
            )}
          </div>
        ))}
      </div>
    </li>
  );
}

/** "+ Add muscle": a muscle group, its side(s), Over / Under / Normal, and optionally the finding it goes with (posture too). */
function AddMuscleDialog({
  findings,
  onAdd,
  onClose,
}: {
  findings: { checkpointId: string; label: string }[];
  onAdd: (muscleId: MuscleId, sides: MarkSide[], status: MarkStatus, source: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [muscle, setMuscle] = useState<string>('');
  const [side, setSide] = useState<'L' | 'R' | 'both'>('both');
  const [st, setSt] = useState<MarkStatus>('over');
  const [source, setSource] = useState('');
  const oneSided = isMuscleId(muscle) && regionSides(muscle)[0] === 'none';
  const ok = isMuscleId(muscle);
  return (
    <AdaptiveDialog
      ref={ref}
      historyId="add-muscle"
      title="Add a muscle"
      titleSafe
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()}>Cancel</Button>
          <Button
            aria-disabled={!ok}
            onClick={() => {
              if (!isMuscleId(muscle)) return;
              onAdd(muscle, oneSided ? ['none'] : side === 'both' ? ['L', 'R'] : [side], st, source || null);
            }}
            data-testid="add-muscle-save"
          >
            Add
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <SelectField label="Muscle group" value={muscle} onChange={(e) => setMuscle(e.target.value)} data-testid="add-muscle-select">
          <option value="">Choose…</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SelectField>
        {!oneSided ? (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legendText}>Side</legend>
            <div className={base.segments} role="radiogroup">
              {(['L', 'R', 'both'] as const).map((s) => (
                <button key={s} type="button" role="radio" className={base.segment} aria-checked={side === s} onClick={() => setSide(s)}>
                  {s === 'both' ? 'Both' : s}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legendText}>Mark as</legend>
          <div className={styles.statusChoices} role="radiogroup">
            {(['over', 'under', 'normal'] as const).map((s) => (
              <button key={s} type="button" role="radio" className={styles.pickerOption} aria-checked={st === s} onClick={() => setSt(s)}>
                <MarkChip status={s} />
                <span>{STATUS_WORDS[s]}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {findings.length > 0 ? (
          <SelectField label="Goes with (optional)" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">No finding</option>
            {findings.map((f) => (
              <option key={f.checkpointId} value={f.checkpointId}>{f.label}</option>
            ))}
          </SelectField>
        ) : null}
        {!ok ? <p className={base.caption}>Choose a muscle group to add it.</p> : null}
        <p className={base.caption}>L and R are the client’s own left and right.</p>
      </div>
    </AdaptiveDialog>
  );
}
