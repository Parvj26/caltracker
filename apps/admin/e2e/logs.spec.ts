import { expect, test } from '@playwright/test';
import { createUser, lit, seedClient, seedCoach, signInAdmin, sql, tag } from './helpers';

test('logs: the Person search finds a typo, picking filters the rows, × shows everyone again', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Logs Coaching ${t}`);
  const client = await seedClient(coach.workspaceId, 'Kay', `K${t}`);
  for (const [user, key] of [[coach.id, `luis-${t}`], [client.id, `kay-${t}`]] as const) {
    sql(`insert into public.push_outbox (user_id, workspace_id, type, group_key)
         values (${lit(user)}, ${lit(coach.workspaceId)}, 'message', ${lit(key)})`);
  }
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);
  await page.goto('/logs');
  await expect(page.getByRole('row', { name: new RegExp(`Kay K${t}`) })).toBeVisible();

  // "Beuno" swaps two letters of "Bueno" (smart search forgives typos only in words of 5+ letters, so not "Luiz").
  // Enter picks the top suggestion and filters straight away (no Filter button).
  const person = page.getByRole('combobox', { name: 'Person' });
  await expect(person).toHaveAttribute('placeholder', 'Search by name or email');
  await expect(page.getByRole('button', { name: 'Filter' })).toHaveCount(0);
  await person.fill(`Luis Beuno${t}`);
  await expect(page.getByRole('option', { name: new RegExp(`Luis Bueno${t}`) })).toBeVisible();
  await person.press('Enter');
  await expect(page).toHaveURL(new RegExp(`person=${coach.id}`));
  await expect(page.getByRole('row', { name: new RegExp(`Luis Bueno${t}`) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Kay K${t}`) })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Person' })).toHaveValue(`Luis Bueno${t}`);

  // Esc closes the suggestions.
  await page.getByRole('combobox', { name: 'Person' }).fill('Kay');
  await expect(page.getByRole('listbox', { name: 'People' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Person' }).press('Escape');
  await expect(page.getByRole('listbox', { name: 'People' })).toBeHidden();

  // The person stays when switching tabs, and × goes back to everyone.
  await page.getByRole('link', { name: 'Invites' }).click();
  await expect(page).toHaveURL(new RegExp(`tab=invites&person=${coach.id}`));
  await page.getByRole('link', { name: 'Notifications' }).click();
  // Wait for the tab to load: × clears the person on the tab it was rendered for.
  await expect(page).toHaveURL(new RegExp(`tab=notifications&person=${coach.id}`));
  await page.getByRole('button', { name: 'Clear person (show everyone)' }).click();
  await expect(page).not.toHaveURL(/person=/);
  await expect(page.getByRole('row', { name: new RegExp(`Kay K${t}`) })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Person' })).toHaveValue('');
});
