import { diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

export const SCAN_DUE_DAYS = 30;

/** Due when the latest coach-entered scan is 30+ days old, or there is none and the client joined 30+ days ago. */
export function isScanDue(client: { joinedOn: IsoDate }, latestCoachScanOn: IsoDate | null, today: IsoDate): boolean {
  return diffDays(latestCoachScanOn ?? client.joinedOn, today) >= SCAN_DUE_DAYS;
}
