'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, useTransition, type FormEvent } from 'react';
import {
  MACRO_KEYS,
  MACRO_NAMES,
  addDays,
  dailyTotals,
  formatMacro,
  formatMealTime,
  hasAnyTarget,
  localToday,
  macroProgress,
  mealMacroLine,
  mealReference,
  mealsByDay,
  shortDayLabel,
  startOfWeek,
  weekDays,
  type IsoDate,
  type MacroKey,
  type MacroTargets,
} from '@caltracker/shared';
import { SharpPhoto } from '@/components/sharp-photo';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import { saveTargets } from './actions';
import type { CoachMeal } from './load';
import { TIME_ZONE_COOKIE } from './week';
import styles from './food.module.css';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const noSubscribe = () => () => undefined;
/** The coach's own time zone in the browser; UTC while rendering on the server. */
const useTimeZone = () => useSyncExternalStore(noSubscribe, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => 'UTC');

const UNIT: Record<MacroKey, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };
const bare = (key: MacroKey, n: number) => formatMacro(key, n).replace(/ (kcal|g)$/, '');

/** "1,240 / 2,000" with a small bar, or the plain total without a target. */
function TotalCell({ macro, total, target }: { macro: MacroKey; total: number; target: number | null }) {
  const p = macroProgress(total, target);
  return (
    <td className={styles.num}>
      <span>
        {bare(macro, total)}
        {p.target !== null ? <span className={styles.muted}> / {bare(macro, p.target)}</span> : null}
        {p.over ? <span className={styles.over}> over</span> : null}
      </span>
      {p.fraction !== null ? (
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} data-over={p.over ? 'true' : 'false'} style={{ width: `${Math.round(p.fraction * 100)}%` }} />
        </span>
      ) : null}
    </td>
  );
}

export function FoodView({
  clientId,
  firstName,
  monday,
  targets,
  meals,
  readOnly,
  serverZone,
  pickedWeek,
}: {
  clientId: string;
  firstName: string;
  monday: IsoDate;
  targets: MacroTargets | null;
  meals: CoachMeal[];
  readOnly: boolean;
  /** The browser zone the server used (from the cookie), or null when it had none and guessed. */
  serverZone: string | null;
  /** True when the address names a week (?week=), so "this week" was not guessed. */
  pickedWeek: boolean;
}) {
  const timeZone = useTimeZone();
  const router = useRouter();
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
  const sunday = days[6]!;
  const daysWithMeals = days.filter((d) => byDay[d]!.length > 0);

  return (
    <div className={styles.page}>
      <TargetsCard clientId={clientId} firstName={firstName} targets={targets} readOnly={readOnly} />

      <section className={styles.section} aria-labelledby="food-week-heading">
        <div className={styles.weekNav}>
          <Link className={styles.navLink} href={`/clients/${clientId}/food?week=${addDays(monday, -7)}`} data-testid="food-prev-week">
            ‹ Previous week
          </Link>
          <h2 id="food-week-heading" className={styles.heading}>
            {shortDayLabel(monday, today)} – {shortDayLabel(sunday, today)}
          </h2>
          {atThisWeek ? (
            <span className={styles.navDisabled} aria-disabled="true">
              Next week ›
            </span>
          ) : (
            <Link className={styles.navLink} href={`/clients/${clientId}/food?week=${addDays(monday, 7)}`} data-testid="food-next-week">
              Next week ›
            </Link>
          )}
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
                  <tr key={d} data-testid={`food-day-${d}`}>
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
        {!shownTargets ? <p className={styles.muted}>No targets yet. Set them above to see each day against them.</p> : null}
      </section>

      {daysWithMeals.length === 0 ? (
        <p className={styles.muted} data-testid="food-empty">
          {firstName} hasn’t logged any meals this week.
        </p>
      ) : (
        [...daysWithMeals].reverse().map((d) => (
          <section key={d} className={styles.section} aria-labelledby={`meals-${d}`}>
            <h2 id={`meals-${d}`} className={styles.heading}>
              {d === today ? 'Today' : shortDayLabel(d, today)}
            </h2>
            <ul className={styles.meals}>
              {byDay[d]!.map((m) => (
                <MealCard key={m.id} meal={m} clientId={clientId} today={today} timeZone={timeZone} readOnly={readOnly} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function MealCard({ meal, clientId, today, timeZone, readOnly }: { meal: CoachMeal; clientId: string; today: IsoDate; timeZone: string; readOnly: boolean }) {
  const macros = mealMacroLine(meal.macros);
  const title = meal.name ?? 'Meal';
  return (
    <li className={styles.meal} data-testid="coach-meal">
      {meal.photo ? (
        <SharpPhoto
          full={meal.photo.full}
          thumb={meal.photo.thumb}
          alt={`${title} photo`}
          width={meal.photo.width}
          height={meal.photo.height}
          maxHeight="360px"
          className={styles.photo}
        />
      ) : null}
      <div className={styles.mealBody}>
        <p className={styles.mealTitle}>
          {title} <span className={styles.muted}>{formatMealTime(meal.eatenAt, timeZone)}</span>
        </p>
        {macros ? <p className={styles.mealMacros}>{macros}</p> : null}
        {meal.note ? <p className={styles.note}>{meal.note}</p> : null}
        {readOnly ? null : (
          <Link
            className={styles.navLink}
            href={`/messages/${clientId}?about=${encodeURIComponent(mealReference(meal, today, timeZone))}`}
            data-testid="meal-reply"
          >
            Reply about this meal
          </Link>
        )}
      </div>
    </li>
  );
}

const toText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function TargetsCard({ clientId, firstName, targets, readOnly }: { clientId: string; firstName: string; targets: MacroTargets | null; readOnly: boolean }) {
  const initial = { calories: toText(targets?.calories), protein: toText(targets?.protein), carbs: toText(targets?.carbs), fat: toText(targets?.fat) };
  const [values, setValues] = useState<Record<MacroKey, string>>(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MacroKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);
  const completeTargets = useAnalyticsTask('set_food_targets', touched && !readOnly);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        const outcome = await saveTargets(clientId, values);
        if (outcome.ok) {
          completeTargets();
          setTouched(false);
          setFieldErrors({});
          setSaved(true);
        } else {
          setFieldErrors(outcome.fieldErrors ?? {});
          setError(outcome.error);
        }
      } catch (err) {
        setError(failureMessage(err, "Couldn't save the targets. Check your connection and try again."));
      }
    });
  }

  return (
    <Card className={styles.targets}>
      <h2 className={styles.heading}>Daily targets</h2>
      {readOnly ? (
        <p className={styles.muted}>
          {hasAnyTarget(targets)
            ? MACRO_KEYS.filter((k) => targets?.[k] != null).map((k) => `${MACRO_NAMES[k]} ${formatMacro(k, targets![k]!)}`).join(' · ')
            : 'No targets were set.'}
        </p>
      ) : (
        <form onSubmit={submit} className={styles.targetsForm} noValidate>
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
                {...(fieldErrors[k] ? { error: fieldErrors[k] } : {})}
                onChange={(e) => {
                  setSaved(false);
                  setTouched(true);
                  setValues((v) => ({ ...v, [k]: e.target.value }));
                }}
                data-testid={`target-${k}`}
              />
            ))}
          </div>
          <div className={styles.formActions}>
            <Button type="submit" pending={pending} data-testid="targets-save">
              Save targets
            </Button>
            {saved ? (
              <span role="status" className={styles.muted}>
                Saved
              </span>
            ) : null}
          </div>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </form>
      )}
    </Card>
  );
}
