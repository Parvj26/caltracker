import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { LABEL_PATTERN } from '@caltracker/shared';

// The phone logging controls carry fixed ph-label names (same rule as the website), so PostHog shows which button
// was tapped. Read from the source: the app has no component renderer in unit tests.
const SRC = join(__dirname, '..');
const EXPECTED: Record<string, string[]> = {
  'components/today/today-cards.tsx': ['log_start_workout', 'log_add_meal'],
  'app/(app)/(tabs)/workouts.tsx': ['log_start_workout'],
  'app/(app)/plan/[id].tsx': ['log_start_workout'],
  'components/log/set-table.tsx': ['log_set_done', 'log_add_set'],
  'components/log/section-start.tsx': ['log_finish_workout'],
  'components/log/log-sheets.tsx': ['log_finish_confirm'],
  'app/(app)/(tabs)/food.tsx': ['log_add_meal'],
  'app/(app)/food/meal.tsx': ['log_meal_save'],
};

it('labels every logging control with its fixed ph-label', () => {
  for (const [file, labels] of Object.entries(EXPECTED)) {
    const source = readFileSync(join(SRC, file), 'utf8');
    for (const label of labels) {
      expect(LABEL_PATTERN.test(label)).toBe(true);
      expect(source, `${file} should carry ph-label="${label}"`).toContain(`ph-label="${label}"`);
    }
  }
});
