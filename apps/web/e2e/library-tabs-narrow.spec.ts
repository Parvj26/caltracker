import { expect, test } from '@playwright/test';
import { signInAsCoach } from './helpers';

// The Library row (Workouts | Exercises | Programs | Corrective) on narrow phones: no label is cut off and the page
// never scrolls sideways. One row of four at 375; two rows of two below 360 (e.g. 320).
for (const width of [375, 320]) {
  test(`the Library section row fits at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await signInAsCoach(page);
    await page.goto('/corrective/templates');
    const links = page.getByRole('navigation', { name: 'Library sections' }).getByRole('link');
    await expect(links).toHaveCount(4);
    for (const link of await links.all()) {
      expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${await link.textContent()} is cut off`).toBe(true);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
