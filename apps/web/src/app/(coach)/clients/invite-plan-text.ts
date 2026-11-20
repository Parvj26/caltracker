import { formatShortDay } from '@/components/calendar/format';
import type { InvitePlanSummary } from './client-directory';

/** "Beginner 3-Day · starts Mon 16 Nov": what a pending invite will begin with, or null. */
export function invitePlanText(plan: InvitePlanSummary): string | null {
  if (!plan) return null;
  if (plan.kind === 'program') return `${plan.name} · starts ${formatShortDay(plan.on)}`;
  return `Single workout: ${plan.name} · ${formatShortDay(plan.on)}${plan.more > 0 ? ` · ${plan.more} more` : ''}`;
}

