import { expect, test } from '@playwright/test';

test('loads the World Lab map shell and reserved development panels', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'World Lab' })).toBeVisible();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Simulation controls' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Agent inspector' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event log' })).toBeVisible();
});
