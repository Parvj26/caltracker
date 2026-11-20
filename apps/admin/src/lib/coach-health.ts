import type { PillTone } from '@/components/pill';

/** admin_coach_health's tags: Active (0-3 days), Going quiet (4-13), Inactive (14+ or never). */
const HEALTH: Record<string, { label: string; tone: PillTone }> = {
  good: { label: 'Active', tone: 'lime' },
  quiet: { label: 'Going quiet', tone: 'tape' },
  inactive: { label: 'Inactive', tone: 'grey' },
};

export function coachHealth(tag: string): { label: string; tone: PillTone } {
  return HEALTH[tag] ?? HEALTH.inactive!;
}

/** The Coaches "This week" cell: "1 built · 0 assigned". */
export function coachWeekLabel(built: number, assigned: number): string {
  return `${built} built · ${assigned} assigned`;
}
