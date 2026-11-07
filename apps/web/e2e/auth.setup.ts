import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup } from '@playwright/test';
import { COACH_STATE, signInThroughForm } from './helpers';

// Signs the demo coach in once per run and saves the session; signInAsCoach() reuses it in every spec.
setup('sign in the demo coach once', async ({ page }) => {
  await signInThroughForm(page);
  mkdirSync(dirname(COACH_STATE), { recursive: true });
  await page.context().storageState({ path: COACH_STATE });
});
