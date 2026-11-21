'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { TEMPLATE_NAME_MAX, TEMPLATE_TESTS_MAX, smartFilter, templateNameProblem, type ErrorCode } from '@caltracker/shared';
import { AdaptiveDialog, Button, ErrorText, ListRow, PageHeader, RowList, SearchBox, SearchEmpty, TextField, type AdaptiveDialogHandle, type FieldError } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { failureCode } from '@/lib/action-errors';
import { useMediaQuery } from '@/lib/use-media-query';
import type { AssessmentTemplate, LibraryTest } from '../../clients/[clientId]/assessments/load';
import { TestIcon } from '../../clients/[clientId]/assessments/parts';
import { createTemplate, deleteTemplate, updateTemplate } from './actions';
import styles from './templates.module.css';

/** A test a template names: in the library now, or a retired one (its last known name). */
type KnownTest = { key: string; name: string; summary: string; offered: boolean };

const plural = (n: number) => `${n} ${n === 1 ? 'test' : 'tests'}`;

/**
 * Library › Corrective › Templates (AS11): the coach's saved sets of tests. The list, and the open template beside it
 * on iPad and desktop (or full screen on a phone). Edit: rename, move tests up and down, swap a test for another, remove
 * one, add one. Delete asks first (inline, so the phone's full-screen editor never opens a second pop-up).
 */
export function TemplatesView({
  templates,
  library,
  retired,
  tabs,
}: {
  templates: AssessmentTemplate[];
  library: LibraryTest[];
  retired: Record<string, string>;
  /** The Library row (and Corrective's own sections). */
  tabs: ReactNode;
}) {
  const phone = useMediaQuery('(max-width: 599.98px)');
  const [selected, setSelected] = useState<string | null>(null);
  // iPad and desktop open the first template beside the list, as on the board.
  const open = selected ?? (phone ? null : (templates[0]?.id ?? null));
  const current = open === 'new' ? null : (templates.find((t) => t.id === open) ?? null);
  const known = (key: string): KnownTest => {
    const t = library.find((l) => l.key === key);
    return t
      ? { key, name: t.definition.name, summary: t.definition.summary, offered: true }
      : { key, name: retired[key] ?? key, summary: 'No longer in the library: left out when used', offered: false };
  };
  const otherNames = templates.filter((t) => t.id !== open).map((t) => t.name);

  const list =
    templates.length === 0 ? (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No templates yet</p>
        <p className={styles.caption}>Save a set of tests you use often, in your order. Pick it when you start an assessment.</p>
      </div>
    ) : (
      <RowList aria-label="Templates" className={styles.list}>
        {templates.map((t) => (
          <ListRow
            key={t.id}
            title={t.name}
            meta={<span data-ph-safe="">{plural(t.testKeys.length)}</span>}
            end={<ChevronIcon direction="right" size={18} />}
            current={!phone && open === t.id}
            onOpen={() => setSelected(t.id)}
            openLabel={`Edit ${t.name}`}
            itemProps={{ 'data-testid': 'template-row' }}
          />
        ))}
      </RowList>
    );

  return (
    <>
      <PageHeader
        title="Corrective"
        subtitle={<span className={styles.intro}>Assessment templates: a set of tests in your order, picked when you start an assessment.</span>}
        action={
          <Button variant="create" size={phone ? 'compact' : 'regular'} onClick={() => setSelected('new')} aria-label="New template" phSafe>
            + Template
          </Button>
        }
      />
      {tabs}
      <div className={styles.layout} data-has-editor={!phone && open !== null ? '' : undefined}>
      <div className={styles.listPane}>{list}</div>
      {open !== null ? (
        <TemplateEditor
          key={open}
          mode={phone ? 'dialog' : 'pane'}
          template={current}
          library={library}
          known={known}
          otherNames={otherNames}
          onDone={(id) => setSelected(phone ? null : id)}
          onClose={() => setSelected(phone ? null : (templates.find((t) => t.id !== open)?.id ?? null))}
        />
      ) : null}
      </div>
    </>
  );
}

function TemplateEditor({
  mode,
  template,
  library,
  known,
  otherNames,
  onDone,
  onClose,
}: {
  mode: 'pane' | 'dialog';
  /** null: a new template. */
  template: AssessmentTemplate | null;
  library: LibraryTest[];
  known: (key: string) => KnownTest;
  otherNames: string[];
  /** Saved (the template's id) or deleted (null). */
  onDone: (id: string | null) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const nameId = useId();
  const [name, setName] = useState(template?.name ?? '');
  const [keys, setKeys] = useState<string[]>(template?.testKeys ?? []);
  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'swap'; key: string }>(template ? null : { mode: 'add' });
  const [query, setQuery] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  const dirty = template === null ? name.trim() !== '' || keys.length > 0 : name !== template.name || keys.join() !== template.testKeys.join();
  const problem = templateNameProblem(name, otherNames);
  const nameError: FieldError | undefined =
    touched && problem
      ? problem === 'empty'
        ? { code: 'field_required', text: 'Give the template a name.' }
        : problem === 'too_long'
          ? { code: 'template_invalid', text: `Use up to ${TEMPLATE_NAME_MAX} characters.` }
          : { code: 'template_name_taken' }
      : undefined;
  const reason = problem ? 'Give the template a name' : keys.length === 0 ? 'Add at least 1 test' : !dirty ? 'No changes to save' : null;
  const available = library.filter((t) => !keys.includes(t.key));
  const shown = smartFilter(available, query, (t) => t.definition.name);

  function move(i: number, by: -1 | 1) {
    setKeys((k) => {
      const next = [...k];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });
  }

  function pick(key: string) {
    if (picker?.mode === 'swap') setKeys((k) => k.map((x) => (x === picker.key ? key : x)));
    else setKeys((k) => [...k, key]);
    setPicker(null);
    setQuery('');
  }

  async function save() {
    setTouched(true);
    if (reason || pending) return;
    setPending('save');
    setError(null);
    try {
      const input = { name, testKeys: keys };
      let id: string;
      if (template) {
        const outcome = await updateTemplate(template.id, input);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        id = template.id;
      } else {
        const outcome = await createTemplate(input);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        id = outcome.id;
      }
      setSaved(true);
      if (mode === 'dialog') await dialogRef.current?.close();
      onDone(id);
      router.refresh();
    } catch (e) {
      setError(failureCode(e, 'template_save_failed'));
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!template || pending) return;
    setPending('delete');
    setError(null);
    try {
      const outcome = await deleteTemplate(template.id);
      if (!outcome.ok) {
        setError(outcome.code);
        return;
      }
      if (mode === 'dialog') await dialogRef.current?.close();
      onDone(null);
      router.refresh();
    } catch (e) {
      setError(failureCode(e, 'template_delete_failed'));
    } finally {
      setPending(null);
    }
  }

  const deleteConfirm = confirmDelete && template ? (
    <div className={styles.confirm} data-testid="delete-confirm">
      <p className={styles.confirmText}>
        <strong>Delete “{template.name}”?</strong> Assessments already started from it keep their tests. This can’t be undone.
      </p>
      <div className={styles.confirmActions}>
        <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={pending !== null} phSafe>Cancel</Button>
        <Button variant="danger" onClick={() => void remove()} pending={pending === 'delete'} phSafe>
          {pending === 'delete' ? 'Deleting…' : 'Delete template'}
        </Button>
      </div>
    </div>
  ) : null;

  const body = (
    <div className={styles.editorBody}>
      <TextField
        id={nameId}
        label="Template name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={TEMPLATE_NAME_MAX + 10}
        placeholder="My lower-body screen"
        autoComplete="off"
        enterKeyHint="done"
        error={nameError}
      />
      <div className={styles.testsBlock}>
        <p className={styles.kicker} id={`${nameId}-tests`}>
          {plural(keys.length)} · in this order
        </p>
        {keys.length > 0 ? (
          <ol className={styles.tests} aria-labelledby={`${nameId}-tests`}>
            {keys.map((k, i) => {
              const t = known(k);
              return (
                <li key={k} className={styles.test} data-retired={t.offered ? undefined : ''}>
                  <span className={styles.testNumber} aria-hidden="true">{i + 1}</span>
                  <span className={styles.testText}>
                    <span className={styles.testName} data-ph-safe="">{t.name}</span>
                    <span className={styles.testSummary} data-ph-safe="">{t.summary}</span>
                  </span>
                  <span className={styles.testActions}>
                    <IconButton label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <path d="M12 19V5M6 11l6-6 6 6" />
                    </IconButton>
                    <IconButton label={`Move ${t.name} down`} disabled={i === keys.length - 1} onClick={() => move(i, 1)}>
                      <path d="M12 5v14M6 13l6 6 6-6" />
                    </IconButton>
                    <IconButton
                      label={`Swap ${t.name} for another test`}
                      pressed={picker?.mode === 'swap' && picker.key === k}
                      disabled={available.length === 0}
                      onClick={() => setPicker((p) => (p?.mode === 'swap' && p.key === k ? null : { mode: 'swap', key: k }))}
                    >
                      <path d="M4 8h14l-3-3M20 16H6l3 3" />
                    </IconButton>
                    <IconButton label={`Remove ${t.name}`} onClick={() => setKeys((x) => x.filter((y) => y !== k))}>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </IconButton>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.caption}>No tests yet. Add the ones you use, in the order you run them.</p>
        )}
        {picker ? (
          <div className={styles.picker} role="group" aria-label={picker.mode === 'swap' ? `Swap ${known(picker.key).name} for` : 'Add a test'}>
            <div className={styles.pickerHead}>
              <p className={styles.pickerTitle} data-ph-safe="">{picker.mode === 'swap' ? `Swap ${known(picker.key).name} for…` : 'Add a test'}</p>
              {keys.length > 0 ? (
                <Button variant="quiet" size="compact" onClick={() => setPicker(null)} phSafe>Done</Button>
              ) : null}
            </div>
            <SearchBox value={query} onChange={setQuery} label="Search tests" />
            {available.length === 0 ? <p className={styles.caption}>Every test is already in this template.</p> : null}
            {available.length > 0 && shown.length === 0 ? <SearchEmpty things="tests" query={query} onClear={() => setQuery('')} /> : null}
            <ul className={styles.pickerList} aria-label="Tests to pick">
              {shown.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    className={styles.pickerItem}
                    onClick={() => pick(t.key)}
                  >
                    <span className={styles.pickerThumb}>
                      <TestIcon />
                    </span>
                    <span className={styles.testText}>
                      <span className={styles.testName} data-ph-safe="">{t.definition.name}</span>
                      <span className={styles.testSummary} data-ph-safe="">{t.definition.summary}</span>
                    </span>
                    <span className={styles.pickerPlus} aria-hidden="true">{picker.mode === 'swap' ? '⇄' : '+'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <Button variant="secondary" size="compact" onClick={() => setPicker({ mode: 'add' })} disabled={keys.length >= TEMPLATE_TESTS_MAX} disabledReason={`Up to ${TEMPLATE_TESTS_MAX} tests`} phSafe>
              + Add test
            </Button>
          </div>
        )}
      </div>
      {error ? <ErrorText code={error} /> : null}
      {mode === 'dialog' && template ? (deleteConfirm ?? (
        <div className={styles.dialogDelete}>
          <Button variant="quiet" className={styles.dangerText} onClick={() => setConfirmDelete(true)} phSafe>Delete template…</Button>
        </div>
      )) : null}
    </div>
  );

  const saveButton = (
    <Button onClick={() => void save()} pending={pending === 'save'} disabled={reason !== null} disabledReason={reason ?? undefined} phSafe>
      {pending === 'save' ? 'Saving…' : 'Save'}
    </Button>
  );

  if (mode === 'dialog') {
    return (
      <AdaptiveDialog
        ref={dialogRef}
        historyId="edit-template"
        title={template ? 'Edit template' : 'New template'}
        titleSafe
        subtitle="Library · Corrective"
        onClose={onClose}
        dirty={dirty}
        discardText="Your changes to this template won’t be saved."
        busy={pending !== null}
        size="wide"
        fullScreenOnPhone
        noKeyboardOnTouch
        footer={
          <>
            <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()} disabled={pending !== null} phSafe>Cancel</Button>
            {saveButton}
          </>
        }
      >
        {body}
      </AdaptiveDialog>
    );
  }

  return (
    <section className={styles.editorPane} aria-label={template ? `Edit ${template.name}` : 'New template'} data-testid="template-editor">
      <h2 className={styles.paneTitle} data-ph-safe="">{template ? 'Edit template' : 'New template'}</h2>
      {body}
      {deleteConfirm ?? (
        <div className={styles.paneActions}>
          {template ? (
            <Button variant="quiet" className={styles.dangerText} onClick={() => setConfirmDelete(true)} phSafe>Delete…</Button>
          ) : (
            <Button variant="secondary" onClick={onClose} phSafe>Cancel</Button>
          )}
          <span className={styles.paneSave}>
            {saved ? (
              <span className={styles.savedNote} role="status" data-ph-safe="">Saved</span>
            ) : null}
            {saveButton}
          </span>
        </div>
      )}
    </section>
  );
}

function IconButton({ label, onClick, disabled = false, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
