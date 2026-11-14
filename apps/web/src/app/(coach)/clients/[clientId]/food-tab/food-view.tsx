'use client';

import type { ErrorCode } from '@caltracker/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from 'react';
import {
  MACRO_KEYS,
  MACRO_NAMES,
  MACRO_SHORT,
  addDays,
  dailyTotals,
  formatMacro,
  formatMealTime,
  formatPlainDay,
  formatWeekRange,
  formatWeekdayDay,
  hasAnyTarget,
  localToday,
  macroProgress,
  mealMacroLine,
  mealReference,
  mealsByDay,
  shortDayLabel,
  startOfWeek,
  targetGap,
  weekDays,
  type IsoDate,
  type MacroKey,
  type MacroTargets,
} from '@caltracker/shared';
import calendar from '@/components/calendar/calendar.module.css';
import { SharpPhoto } from '@/components/sharp-photo';
import { useStableSrc } from '@/components/stable-img';
import { Button, ButtonLink, Card, Chip, ErrorText, TextField, errorFromText } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import sheet from '@/components/ui/sheet.module.css';
import { failureCode } from '@/lib/action-errors';
import { saveTargets } from './actions';
import type { CoachMeal } from './load';
import { TIME_ZONE_COOKIE, weekRows } from './week';
import styles from './food.module.css';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const noSubscribe = () => () => undefined;
/** The coach's own time zone in the browser; UTC while rendering on the server. */
const useTimeZone = () => useSyncExternalStore(noSubscribe, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => 'UTC');

const UNIT: Record<MacroKey, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };
const bare = (key: MacroKey, n: number) => formatMacro(key, n).replace(/ (kcal|g)$/, '');
const mealCount = (n: number) => `${n} ${n === 1 ? 'meal' : 'meals'}`;

/** "1,240 / 2,000" (and "over" past the target), or the plain total without a target. */
function MacroAmount({ macro, total, target }: { macro: MacroKey; total: number; target: number | null }) {
  const p = macroProgress(total, target);
  return (
    <span>
      {bare(macro, total)}
      {p.target !== null ? <span className={styles.muted}> / {bare(macro, p.target)}</span> : null}
      {p.over ? <span className={styles.over}> over</span> : null}
    </span>
  );
}

/** A thin bar of a total against its target (nothing without a target). */
function Track({ fraction, over, thin = false }: { fraction: number | null; over: boolean; thin?: boolean }) {
  if (fraction === null) return null;
  return (
    <span className={cx(styles.track, thin && styles.trackThin)} aria-hidden="true">
      <span className={styles.fill} data-over={over ? 'true' : 'false'} style={{ width: `${Math.round(fraction * 100)}%` }} />
    </span>
  );
}

function MacroTrack({ total, target }: { total: number; target: number | null }) {
  const p = macroProgress(total, target);
  return <Track fraction={p.fraction} over={p.over} />;
}

/** "1,240 / 2,000" with a small bar, or the plain total without a target. */
function TotalCell({ macro, total, target }: { macro: MacroKey; total: number; target: number | null }) {
  return (
    <td className={styles.num}>
      <MacroAmount macro={macro} total={total} target={target} />
      <MacroTrack total={total} target={target} />
    </td>
  );
}

/** A bowl, standing in for a meal logged without a photo. */
function BowlIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <path d="M5 19h30a15 13 0 0 1-30 0z" />
      <circle cx="14" cy="15" r="2.5" />
      <circle cx="21" cy="14" r="2.5" />
      <circle cx="27" cy="15.5" r="2.5" />
    </svg>
  );
}

function SpeechIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

type MealContext = { clientId: string; firstName: string; today: IsoDate; timeZone: string; readOnly: boolean; onPhoto: (meal: CoachMeal) => void };

export function FoodView({
  clientId,
  firstName,
  monday,
  targets,
  meals,
  everLogged,
  readOnly,
  serverZone,
  pickedWeek,
}: {
  clientId: string;
  firstName: string;
  monday: IsoDate;
  targets: MacroTargets | null;
  meals: CoachMeal[];
  /** Whether the client has ever logged a meal (any week). */
  everLogged: boolean;
  readOnly: boolean;
  /** The browser zone the server used (from the cookie), or null when it had none and guessed. */
  serverZone: string | null;
  /** True when the address names a week (?week=), so "this week" was not guessed. */
  pickedWeek: boolean;
}) {
  const timeZone = useTimeZone();
  const router = useRouter();
  const [photo, setPhoto] = useState<CoachMeal | null>(null);
  // Tell the server this browser's zone for next time; if it guessed this week wrong, load the right one now.
  useEffect(() => {
    if (timeZone === serverZone) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;
    if (!pickedWeek && startOfWeek(localToday(timeZone)) !== monday) router.refresh();
  }, [timeZone, serverZone, pickedWeek, monday, router]);
  const today = localToday(timeZone);
  const days = weekDays(monday);
  const byDay = mealsByDay(meals, days);
  const shownTargets = hasAnyTarget(targets) ? targets : null;
  const atThisWeek = monday >= startOfWeek(today);
  const hasToday = days.includes(today);
  const daysWithMeals = days.filter((d) => byDay[d]!.length > 0);
  const ctx: MealContext = { clientId, firstName, today, timeZone, readOnly, onPhoto: setPhoto };

  const targetsRow = <TargetsSummary clientId={clientId} firstName={firstName} targets={targets} readOnly={readOnly} />;
  const photoDialog = photo?.photo ? <PhotoDialog meal={photo} onClose={() => setPhoto(null)} /> : null;

  // A client who never logged food: one message in place of a week of zeros.
  if (!everLogged) {
    return (
      <div className={styles.page}>
        <Card className={styles.empty} data-testid="food-empty">
          <span className={styles.emptyIcon}>
            <BowlIcon size={44} />
          </span>
          <h2 className={styles.heading}>{firstName} hasn’t logged any meals yet</h2>
          <p className={styles.muted}>They’ll appear here.</p>
          {readOnly ? null : (
            <ButtonLink variant="secondary" href={`/messages/${clientId}`} className={styles.emptyButton}>
              Message {firstName}
            </ButtonLink>
          )}
        </Card>
        {targetsRow}
      </div>
    );
  }

  const rows = weekRows(days, byDay, today, shownTargets?.calories ?? null);
  // Desktop and iPad: the days other than today (shown at the top) with their meals, newest first.
  const earlierDays = [...daysWithMeals].reverse().filter((d) => d !== today);

  return (
    <div className={styles.page}>
      {hasToday ? (
        <div className={styles.section}>
          <TodaySection meals={byDay[today]!} targets={shownTargets} ctx={ctx} />
          {targetsRow}
        </div>
      ) : (
        targetsRow
      )}

      <section className={styles.section} aria-labelledby="food-week-heading">
        <div className={styles.weekHead}>
          <h2 id="food-week-heading" className={styles.heading}>
            {hasToday ? 'This week' : 'Week'}
          </h2>
          <div className={styles.switcher}>
            <Link className={styles.iconButton} href={`/clients/${clientId}/food?week=${addDays(monday, -7)}`} aria-label="Previous week" data-testid="food-prev-week">
              <ChevronIcon direction="left" />
            </Link>
            <span className={styles.range} data-testid="food-week-range">
              {formatWeekRange(monday)}
            </span>
            {atThisWeek ? (
              <span className={styles.iconButton} aria-disabled="true" aria-label="Next week" role="link" data-disabled="true">
                <ChevronIcon direction="right" />
              </span>
            ) : (
              <Link className={styles.iconButton} href={`/clients/${clientId}/food?week=${addDays(monday, 7)}`} aria-label="Next week" data-testid="food-next-week">
                <ChevronIcon direction="right" />
              </Link>
            )}
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="food-week">
            <caption className={styles.srOnly}>Daily totals{shownTargets ? ' against targets' : ''}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {MACRO_KEYS.map((k) => (
                  <th key={k} scope="col" className={styles.num}>
                    {MACRO_NAMES[k]} ({UNIT[k]})
                  </th>
                ))}
                <th scope="col" className={styles.num}>
                  Meals
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const list = byDay[d]!;
                const totals = dailyTotals(list.map((m) => m.macros));
                return (
                  <tr key={d} data-testid={`food-day-${d}`} data-today={d === today ? 'true' : undefined}>
                    <th scope="row">{d === today ? 'Today' : shortDayLabel(d, today)}</th>
                    {MACRO_KEYS.map((k) => (
                      <TotalCell key={k} macro={k} total={totals[k]} target={shownTargets?.[k] ?? null} />
                    ))}
                    <td className={styles.num}>{list.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Phones: one compact row per day (calories, a thin bar, the meal count); tap a day to see its meals. */}
        <ul className={styles.phoneDays} aria-label={`Daily calories${shownTargets?.calories != null ? ' against the target' : ''}`} data-testid="food-week-phone">
          {rows.map((r) => (
            <PhoneDay key={r.day} row={r} meals={byDay[r.day]!} ctx={ctx} />
          ))}
        </ul>
        {!shownTargets ? <p className={styles.muted}>No targets yet. Set them to see each day against them.</p> : null}
      </section>

      {earlierDays.length > 0 ? (
        <section className={cx(styles.section, styles.wideOnly)} aria-labelledby="food-earlier-heading">
          <h2 id="food-earlier-heading" className={styles.heading}>
            {hasToday ? 'Earlier this week' : 'Meals'}
          </h2>
          {earlierDays.map((d) => (
            <div key={d} className={styles.section}>
              <h3 className={styles.subheading}>{shortDayLabel(d, today)}</h3>
              <ul className={styles.meals}>
                {byDay[d]!.map((m) => (
                  <MealRow key={m.id} meal={m} ctx={ctx} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      {photoDialog}
    </div>
  );
}

/** Today's totals against the targets, then every meal logged today with its photo. */
function TodaySection({ meals, targets, ctx }: { meals: CoachMeal[]; targets: MacroTargets | null; ctx: MealContext }) {
  const totals = dailyTotals(meals.map((m) => m.macros));
  const kcal = macroProgress(totals.calories, targets?.calories ?? null);
  const gap = targetGap('calories', totals.calories, kcal.target);
  return (
    <section className={styles.section} aria-labelledby="food-today-heading" data-testid="food-today">
      <div className={styles.todayHead}>
        <h2 id="food-today-heading" className={styles.heading}>
          Today · {formatPlainDay(ctx.today)}
        </h2>
        <span className={styles.muted}>so far</span>
      </div>
      <Card className={styles.todayCard} data-testid="food-today-totals">
        <p className={styles.kcalLine}>
          <span className={styles.big}>{bare('calories', totals.calories)}</span>
          <span className={styles.muted}>{kcal.target !== null ? ` / ${bare('calories', kcal.target)} kcal` : ' kcal'}</span>
          {gap ? (
            <span className={cx(styles.gap, kcal.over && styles.over)} data-testid="food-today-gap">
              {gap}
            </span>
          ) : null}
        </p>
        <Track fraction={kcal.fraction} over={kcal.over} />
        <dl className={styles.macroGrid}>
          {(['protein', 'carbs', 'fat'] as const).map((k) => {
            const p = macroProgress(totals[k], targets?.[k] ?? null);
            return (
              <div key={k} className={styles.macro}>
                <dt className={styles.caption}>{MACRO_NAMES[k]}</dt>
                <dd className={styles.macroValue}>
                  <b>{bare(k, totals[k])}</b>
                  {p.target !== null ? <span className={styles.muted}> / {bare(k, p.target)} g</span> : <span className={styles.muted}> g</span>}
                </dd>
                <Track fraction={p.fraction} over={p.over} thin />
              </div>
            );
          })}
        </dl>
      </Card>
      {meals.length === 0 ? (
        <p className={styles.muted} data-testid="food-today-empty">
          No meals logged yet today.
        </p>
      ) : (
        <ul className={styles.meals}>
          {meals.map((m) => (
            <MealRow key={m.id} meal={m} ctx={ctx} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One day of the phone week: calories, a thin bar and the meal count; tapping it shows that day's meals. */
function PhoneDay({ row, meals, ctx }: { row: ReturnType<typeof weekRows>[number]; meals: CoachMeal[]; ctx: MealContext }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const name = row.isToday ? (
    <Chip tone="lime" phSafe>
      Today
    </Chip>
  ) : (
    formatWeekdayDay(row.day)
  );
  if (row.state !== 'meals') {
    return (
      <li className={styles.phoneDay} data-testid={`food-phone-day-${row.day}`}>
        <div className={cx(styles.dayRow, styles.dayRowQuiet)}>
          <span className={cx(styles.dayName, !row.isToday && styles.dayNameMuted)}>{name}</span>
          <span className={styles.caption}>{row.state === 'future' ? 'Not yet' : 'No meals'}</span>
        </div>
      </li>
    );
  }
  return (
    <li className={styles.phoneDay} data-testid={`food-phone-day-${row.day}`}>
      <button type="button" className={styles.dayRow} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
        <span className={styles.dayName}>{name}</span>
        <span className={styles.dayKcal}>
          <span>
            <b>{bare('calories', row.calories)}</b> kcal{row.over ? <span className={styles.over}> · {row.over}</span> : null}
          </span>
          <Track fraction={row.fraction} over={row.over !== null} thin />
        </span>
        <span className={styles.dayCount}>{mealCount(row.mealCount)}</span>
        <span className={styles.dayChevron} data-open={open ? 'true' : 'false'}>
          <ChevronIcon direction="right" size={18} />
        </span>
      </button>
      {open ? (
        <ul id={listId} className={styles.dayMeals}>
          {meals.map((m) => (
            <MealRow key={m.id} meal={m} ctx={ctx} small />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A meal: its photo (tap for the whole photo), name, time and macros, note, and the link to message about it. */
function MealRow({ meal, ctx, small = false }: { meal: CoachMeal; ctx: MealContext; small?: boolean }) {
  const title = meal.name ?? 'Meal';
  const macros = mealMacroLine(meal.macros);
  const time = formatMealTime(meal.eatenAt, ctx.timeZone);
  const detail = small && meal.macros.calories !== null ? `${time} · ${formatMacro('calories', meal.macros.calories)}` : [time, macros].filter(Boolean).join(' · ');
  return (
    <li className={cx(styles.meal, small && styles.mealSmall)} data-testid="coach-meal">
      {meal.photo ? (
        <button type="button" className={styles.thumb} aria-label={`See ${title} photo larger`} onClick={() => ctx.onPhoto(meal)}>
          <Thumb src={meal.photo.thumb ?? meal.photo.full} />
        </button>
      ) : (
        <span className={cx(styles.thumb, styles.thumbEmpty)}>
          <BowlIcon size={small ? 26 : 36} />
        </span>
      )}
      <div className={styles.mealBody}>
        <p className={styles.mealTitle}>{title}</p>
        <p className={styles.caption}>{detail}</p>
        {meal.note && !small ? <p className={styles.note}>{meal.note}</p> : null}
      </div>
      {ctx.readOnly ? null : (
        <Link
          className={styles.iconButton}
          href={`/messages/${ctx.clientId}?about=${encodeURIComponent(mealReference(meal, ctx.today, ctx.timeZone))}`}
          aria-label={`Message ${ctx.firstName} about ${title}`}
          data-testid="meal-reply"
        >
          <SpeechIcon />
        </Link>
      )}
    </li>
  );
}

function Thumb({ src }: { src: string }) {
  const [current, retry] = useStableSrc(src);
  // eslint-disable-next-line @next/next/no-img-element -- a private photo behind a signed URL
  return <img src={current} alt="" className={styles.thumbImg} loading="lazy" onError={retry} data-ph-block="" />;
}

/** The whole photo of a meal, sharp, in a dialog (full screen on a phone). */
function PhotoDialog({ meal, onClose }: { meal: CoachMeal; onClose: () => void }) {
  const ref = useModal();
  const titleId = useId();
  const title = meal.name ?? 'Meal';
  const photo = meal.photo!;
  return (
    <dialog ref={ref} className={cx(calendar.dialog, sheet.sheet, styles.photoDialog)} aria-labelledby={titleId} onClose={onClose}>
      <div className={sheet.header}>
        <h2 id={titleId} className={calendar.dialogTitle}>
          {title}
        </h2>
        <button type="button" className={sheet.close} aria-label="Close" onClick={() => ref.current?.close()}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <SharpPhoto full={photo.full} thumb={photo.thumb} alt={`${title} photo`} width={photo.width} height={photo.height} maxHeight="70vh" className={styles.photo} />
      <div className={cx(calendar.dialogActions, sheet.actions)}>
        <Button variant="secondary" onClick={() => ref.current?.close()}>
          Close
        </Button>
      </div>
    </dialog>
  );
}

/** Opens the dialog as a modal when it mounts, and gives focus back to what opened it when it goes. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return ref;
}

const toText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** "2,100 kcal · 150 P · 200 C · 70 F": only the targets that are set. */
function targetsLine(t: MacroTargets): string {
  return MACRO_KEYS.filter((k) => t[k] !== null)
    .map((k) => (k === 'calories' ? formatMacro(k, t[k]!) : `${bare(k, t[k]!)} ${MACRO_SHORT[k]}`))
    .join(' · ');
}

/** The targets in one line, with Edit (or Set) opening the targets form. */
function TargetsSummary({ clientId, firstName, targets, readOnly }: { clientId: string; firstName: string; targets: MacroTargets | null; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const any = hasAnyTarget(targets);
  return (
    <div className={styles.targetsRow} data-testid="food-targets">
      <div className={styles.targetsText}>
        <span className={styles.targetsTitle}>Targets</span>
        <span className={cx(styles.caption, styles.targetsLine)} data-testid="food-targets-line">
          {any ? targetsLine(targets!) : readOnly ? 'No targets were set.' : `None yet. ${firstName} sees them in the app.`}
        </span>
      </div>
      {saved ? (
        <span role="status" className={styles.caption}>
          Saved
        </span>
      ) : null}
      {readOnly ? null : (
        <Button
          variant="secondary"
          className={styles.editButton}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
          aria-label={any ? 'Edit targets' : 'Set targets'}
          data-testid="targets-edit"
        >
          {any ? 'Edit' : 'Set'}
        </Button>
      )}
      {editing ? (
        <TargetsDialog
          clientId={clientId}
          firstName={firstName}
          targets={targets}
          onSaved={() => setSaved(true)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/** The targets form, in a dialog (full screen on a phone). Any field can be left blank. */
function TargetsDialog({
  clientId,
  firstName,
  targets,
  onSaved,
  onClose,
}: {
  clientId: string;
  firstName: string;
  targets: MacroTargets | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const ref = useModal();
  const titleId = useId();
  const [values, setValues] = useState<Record<MacroKey, string>>(() => ({
    calories: toText(targets?.calories),
    protein: toText(targets?.protein),
    carbs: toText(targets?.carbs),
    fat: toText(targets?.fat),
  }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MacroKey, string>>>({});
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);
  const completeTargets = useAnalyticsTask('set_food_targets', touched);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        const outcome = await saveTargets(clientId, values);
        if (outcome.ok) {
          completeTargets();
          setTouched(false);
          setFieldErrors({});
          onSaved();
          ref.current?.close();
        } else {
          setFieldErrors(outcome.fieldErrors ?? {});
          setError(outcome.code);
        }
      } catch (err) {
        setError(failureCode(err, 'targets_save_offline'));
      }
    });
  }

  return (
    <dialog
      ref={ref}
      className={cx(calendar.dialog, sheet.sheet)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onClose}
    >
      <div className={sheet.header}>
        <h2 id={titleId} className={calendar.dialogTitle}>
          Daily targets
        </h2>
        <button type="button" className={sheet.close} aria-label="Close" onClick={() => ref.current?.close()} disabled={pending}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <form onSubmit={submit} className={cx(styles.targetsForm, sheet.body)} noValidate>
        <p className={styles.muted}>Any of these can be left blank. {firstName} sees them on the Food tab.</p>
        <div className={styles.targetFields}>
          {MACRO_KEYS.map((k) => (
            <TextField
              key={k}
              label={`${MACRO_NAMES[k]} (${UNIT[k]})`}
              name={k}
              inputMode="decimal"
              value={values[k]}
              placeholder="No target"
              {...(fieldErrors[k] ? { error: errorFromText(fieldErrors[k], 'targets_invalid') } : {})}
              onChange={(e) => {
                setTouched(true);
                setValues((v) => ({ ...v, [k]: e.target.value }));
              }}
              data-testid={`target-${k}`}
            />
          ))}
        </div>
        {error ? <ErrorText code={error} /> : null}
        <div className={cx(calendar.dialogActions, sheet.actions)}>
          <Button variant="secondary" onClick={() => ref.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" pending={pending} data-testid="targets-save">
            Save targets
          </Button>
        </div>
      </form>
    </dialog>
  );
}
