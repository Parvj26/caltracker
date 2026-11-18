import { expect, test } from '@playwright/test';
import { signInAsCoach } from './helpers';

// Page styles must win over the UI kit's whatever order the production build loads the stylesheets in (the kit sits in
// a lower cascade layer, see app/globals.css). The first sign of a flipped order was the side menu showing both logos.
for (const [device, size, full] of [
  ['desktop', { width: 1440, height: 900 }, true],
  ['iPad portrait', { width: 820, height: 1180 }, false],
] as const) {
  test(`on ${device} the side menu shows exactly one logo`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    const logos = page.getByRole('img', { name: 'CalTracker' }).filter({ visible: true });
    await expect(logos).toHaveCount(1);
    // The full logo (mark and wordmark) on a wide screen; the mark alone in the narrow side menu.
    if (full) await expect(logos).toHaveText('caltracker');
    else await expect(logos).toHaveText('');
  });
}
