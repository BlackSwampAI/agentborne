import { expect, test } from '@playwright/test';

test('runs the complete deterministic World Lab browser flow', async ({
  page,
}) => {
  const openRouterRequests: string[] = [];
  const browserFailures: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('openrouter.ai'))
      openRouterRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    browserFailures.push(
      `request failed: ${request.method()} ${request.url()} · ${request.failure()?.errorText ?? 'unknown'}`,
    );
  });
  page.on('pageerror', (error) => {
    browserFailures.push(`page error: ${error.message}`);
  });

  await page.goto('/');

  try {
    await expect(page.getByText('Automated-test provider')).toBeVisible({
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nBrowser failures:\n${browserFailures.join('\n') || 'none captured'}`,
    );
  }

  await expect(page.getByRole('heading', { name: 'World Lab' })).toBeVisible();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await expect(
    page.getByText(/H3 overlay ready · 61 cells · 6 agents/),
  ).toBeVisible();
  await expect(page.getByTestId('infected-count')).toHaveText('0 infected');

  const markers = page.getByRole('button', { name: /Select agent/ });
  await expect(markers).toHaveCount(6);
  await page.getByRole('button', { name: 'Select agent Rook' }).click();
  await expect(page.getByRole('heading', { name: /Rook/ })).toBeVisible();
  await expect(
    page.getByText('2507bb46-7ae4-45ca-8dda-644c4f85ca14'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByText(/Infection ·/)).toBeVisible();
  await expect(page.getByTestId('infected-count')).toHaveText('1 infected');

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByText('Turn 2', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Turn 0')).toBeVisible();
  await expect(page.getByTestId('infected-count')).toHaveText('0 infected');
  await expect(
    page.getByText('Development world loaded with six agents.'),
  ).toBeVisible();
  expect(openRouterRequests).toEqual([]);
});
