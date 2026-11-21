import type { AssessmentDetail } from './load';

/**
 * Where step 2 (findings → suspected muscles → corrective exercises, boards AS4, AS5, AS5b) plugs into the report (AS6)
 * and Compare (AS7). Each slot is a server component that renders nothing until step 2 fills it in, so the pages show
 * no empty boxes meanwhile. The report and Compare pages already render them in the board's places:
 *
 *   report:  Priorities (under the score), the coach-confirmed body map (top of the second column),
 *            Suggested workout + Open in builder (end of the second column)
 *   compare: the body maps per column (under the score card), "Muscles · coach-confirmed" (after Measurements)
 *
 * Step 2 replaces these bodies (they may become async server components and load their own rows, e.g. assessment_muscle_marks, by assessment id). Each one
 * should return a <Card className={styles.card}> from assessments.module.css, like the cards around it, or null.
 */

type ReportSlotProps = { clientId: string; assessment: AssessmentDetail };
type CompareSlotProps = { clientId: string; columns: AssessmentDetail[] };

export function ReportPriorities(props: ReportSlotProps) {
  void props;
  return null;
}

export function ReportBodyMap(props: ReportSlotProps) {
  void props;
  return null;
}

export function ReportSuggestedWorkout(props: ReportSlotProps) {
  void props;
  return null;
}

export function CompareBodyMaps(props: CompareSlotProps) {
  void props;
  return null;
}

export function CompareMuscles(props: CompareSlotProps) {
  void props;
  return null;
}
