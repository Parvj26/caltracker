'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  SLOT_LABELS,
  cycleView,
  formatPlainDayMonthInYear,
  type AssessmentSlot,
  type CycleSummary,
  type Finding,
  type SlotState,
} from '@caltracker/shared';
import { Button, ButtonLink, Card } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { useLocalToday } from '@/lib/local-today';
import { useMediaQuery } from '@/lib/use-media-query';
import { LimitationsCard } from '../overview/editors';
import { assessmentHref, compareHref } from './links';
import type { AssessmentTemplate, LibraryTest } from './load';
import { CheckIcon, FindingsList } from './parts';
import { StartDialog } from './start-dialog';
import styles from './assessments.module.css';

type Client = { id: string; name: string; firstName: string };


/**
 * The "Limitations & injuries" tab (AS1). One column on a phone and iPad; on a desktop the assessments sit left and the
 * injuries note right.
 */
export function LimitationsView({
  client,
  cycles,
  library,
  templates,
  initialKeys,
  latest,
  findings,
  limitations,
  readOnly,
}: {
  client: Client;
  cycles: CycleSummary[];
  library: LibraryTest[];
  templates: AssessmentTemplate[];
  initialKeys: string[];
  latest: { id: string; slot: AssessmentSlot; assessedOn: string } | null;
  findings: Finding[];
  limitations: string;
  readOnly: boolean;
}) {
  const today = useLocalToday();
  const phone = useMediaQuery('(max-width: 599.98px)');
  const [starting, setStarting] = useState<{ slot: AssessmentSlot; newCycle: boolean } | null>(null);
  const day = (iso: string) => formatPlainDayMonthInYear(iso, today);

  return (
    <div className={styles.tab}>
      <div className={styles.tabGrid}>
        <div className={styles.tabMain}>
          <CycleCard client={client} cycles={cycles} readOnly={readOnly} onStart={(slot, newCycle) => setStarting({ slot, newCycle })} />
          {latest ? (
            <Card className={styles.card} aria-labelledby="latest-heading" data-testid="latest-findings">
              <Link href={assessmentHref(client.id, latest.id)} className={styles.headLink}>
                <h2 id="latest-heading" className={styles.heading}>
                  {SLOT_LABELS[latest.slot]} · {day(latest.assessedOn)}
                </h2>
                <ChevronIcon direction="right" size={18} />
              </Link>
              <p className={styles.kicker}>Observed</p>
              <FindingsList findings={findings} {...(phone ? { limit: 3 } : {})} moreHref={assessmentHref(client.id, latest.id)} />
              {/* Step 2 adds "Suggested workout" (and the body map) here. */}
              <div className={styles.cardActions}>
                <ButtonLink href={assessmentHref(client.id, latest.id)} variant="secondary" size="compact" phSafe>
                  Report
                </ButtonLink>
              </div>
            </Card>
          ) : null}
        </div>
        <LimitationsCard clientId={client.id} body={limitations} readOnly={readOnly} />
      </div>
      {starting ? (
        <StartDialog
          client={client}
          slot={starting.slot}
          newCycle={starting.newCycle}
          library={library}
          templates={templates}
          defaultKeys={starting.slot === 'initial' ? [] : initialKeys}
          onClose={() => setStarting(null)}
        />
      ) : null}
    </div>
  );
}

function CycleCard({
  client,
  cycles,
  readOnly,
  onStart,
}: {
  client: Client;
  cycles: CycleSummary[];
  readOnly: boolean;
  onStart: (slot: AssessmentSlot, newCycle: boolean) => void;
}) {
  const today = useLocalToday();
  const view = cycleView(cycles);
  const day = (iso: string) => formatPlainDayMonthInYear(iso, today);
  const first = view.current?.assessments.find((a) => a.slot === 'initial');
  // Compare once two assessments of the cycle are done (Initial and Retest 1).
  const canCompare = (view.current?.assessments.filter((a) => a.status === 'done').length ?? 0) >= 2;
  return (
    <Card className={styles.card} aria-labelledby="assessments-heading" data-testid="assessments-card">
      <div className={styles.cardHead}>
        <h2 id="assessments-heading" className={styles.heading}>Assessments</h2>
        <p className={styles.caption}>
          Cycle {view.number}
          {first ? ` · from ${day(first.assessedOn)}` : ''}
        </p>
      </div>
      <ol className={styles.slots} aria-label={`Cycle ${view.number}`}>
        {view.slots.map((s, i) => (
          <li key={s.slot}>
            <Slot state={s} index={i + 1} client={client} firstTime={view.current === null} readOnly={readOnly} onStart={() => onStart(s.slot, view.current === null)} day={day} />
          </li>
        ))}
      </ol>
      {(canCompare || (view.canStartNewCycle && !readOnly)) && view.current ? (
        <div className={styles.cycleActions}>
          {canCompare ? (
            <ButtonLink href={compareHref(client.id, view.current.id)} variant="secondary" phSafe>
              Compare
            </ButtonLink>
          ) : null}
          {view.canStartNewCycle && !readOnly ? (
            <Button variant="create" onClick={() => onStart('initial', true)}>+ New cycle</Button>
          ) : null}
        </div>
      ) : null}
      {view.past.length > 0 ? (
        <div className={styles.past}>
          <p className={styles.kicker}>Past cycles</p>
          {view.past.map((c) => {
            const done = c.assessments.filter((a) => a.status === 'done').sort((a, b) => a.assessedOn.localeCompare(b.assessedOn));
            const from = done[0];
            const to = done[done.length - 1];
            return (
              <details key={c.id} className={styles.pastCycle}>
                <summary className={styles.pastSummary}>
                  <span className={styles.slotText}>
                    <span className={styles.slotName}>Cycle {c.number}</span>
                    <span className={styles.slotMeta}>
                      {from && to ? `${day(from.assessedOn)} – ${day(to.assessedOn)} · ` : ''}
                      {done.length} {done.length === 1 ? 'assessment' : 'assessments'}
                    </span>
                  </span>
                  <span className={styles.pastChevron}>
                    <ChevronIcon direction="right" size={18} />
                  </span>
                </summary>
                <ul className={styles.pastList}>
                  {done.map((a) => (
                    <li key={a.id}>
                      <Link href={assessmentHref(client.id, a.id)} className={styles.pastLink}>
                        <span>
                          {SLOT_LABELS[a.slot]} · {day(a.assessedOn)}
                          {a.score !== null ? ` · score ${a.score}` : ''}
                        </span>
                        <ChevronIcon direction="right" size={18} />
                      </Link>
                    </li>
                  ))}
                  {done.length >= 2 ? (
                    <li>
                      <Link href={compareHref(client.id, c.id)} className={styles.pastLink}>
                        <span>Compare cycle {c.number}</span>
                        <ChevronIcon direction="right" size={18} />
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </details>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

function Slot({
  state: s,
  index,
  client,
  firstTime,
  readOnly,
  onStart,
  day,
}: {
  state: SlotState;
  index: number;
  client: Client;
  firstTime: boolean;
  readOnly: boolean;
  onStart: () => void;
  day: (iso: string) => string;
}) {
  const name = SLOT_LABELS[s.slot];
  const badge =
    s.state === 'done' ? (
      <span className={styles.slotBadge} data-done="">
        <CheckIcon />
      </span>
    ) : (
      <span className={styles.slotBadge} aria-hidden="true">{index}</span>
    );
  if (s.state === 'done') {
    const meta = `${day(s.assessment.assessedOn)}${s.assessment.score !== null ? ` · score ${s.assessment.score}` : ''}`;
    // The whole slot opens the report.
    return (
      <Link href={assessmentHref(client.id, s.assessment.id)} className={styles.slot} data-state="done" data-testid={`slot-${s.slot}`}>
        {badge}
        <span className={styles.slotText}>
          <span className={styles.slotName}>
            {name}
            <span className={styles.srOnly}>, done</span>
          </span>
          <span className={styles.slotMeta}>{meta}</span>
        </span>
        <span className={styles.slotChevron}>
          <ChevronIcon direction="right" size={18} />
        </span>
      </Link>
    );
  }
  if (s.state === 'draft') {
    return (
      <div className={styles.slot} data-state="draft" data-testid={`slot-${s.slot}`}>
        {badge}
        <span className={styles.slotText}>
          <span className={styles.slotName}>{name}</span>
          <span className={styles.slotMeta}>In progress</span>
        </span>
        <span className={styles.slotAction}>
          <ButtonLink href={assessmentHref(client.id, s.assessment.id)} size="compact" aria-label={`Resume ${name}`}>
            Resume
          </ButtonLink>
        </span>
      </div>
    );
  }
  const meta =
    s.state === 'due'
      ? s.dueOn
        ? `Due ${day(s.dueOn)}`
        : firstTime
          ? 'Not done yet'
          : 'Due now'
      : s.state === 'optional'
        ? 'Optional'
        : s.slot === 'retest_2'
          ? 'Optional'
          : `After ${s.slot === 'retest_1' ? 'Initial' : 'Retest 1'}`;
  return (
    <div className={styles.slot} data-state={s.state} data-testid={`slot-${s.slot}`}>
      {badge}
      <span className={styles.slotText}>
        <span className={styles.slotName}>{name}</span>
        <span className={styles.slotMeta}>{meta}</span>
      </span>
      {(s.state === 'due' || s.state === 'optional') && !readOnly ? (
        <span className={styles.slotAction}>
          <Button variant={s.state === 'due' ? 'primary' : 'secondary'} size="compact" onClick={onStart} aria-label={`Start ${name}`}>
            {firstTime ? `Start ${name}` : 'Start'}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
