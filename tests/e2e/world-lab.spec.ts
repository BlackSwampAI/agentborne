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
  const worldMap = page.getByTestId('world-map');
  await expect(worldMap).toBeVisible();
  await expect(worldMap).toHaveAttribute('data-overlay-status', 'ready');
  await expect(worldMap).toHaveAttribute('data-rendered-h3-cell-count', '61');
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '0',
  );
  await expect(
    page.getByText(/H3 overlay ready · 61\/61 rendered cells · 6 agents/),
  ).toBeVisible();
  await expect(page.getByTestId('infected-count')).toHaveText(
    '0 rendered infected',
  );

  const markers = page.getByRole('button', { name: /Select agent/ });
  await expect(markers).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(markers.nth(index)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Select agent Ember' }).click();
  await expect(page.getByRole('heading', { name: /Ember/ })).toBeVisible();
  const defaultPersonality =
    'You are an aggressive infector. Prefer infecting open cells and move decisively toward uninfected space when your current cell is already infected.';
  const customPersonality =
    'Infect every open current cell, then move decisively to an adjacent open cell.';
  await expect(
    page.getByText(defaultPersonality, { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  const personalityEditor = page.getByRole('textbox', {
    name: 'Personality directive',
  });
  await personalityEditor.fill(customPersonality);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByText(customPersonality, { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByText(/Infection ·/)).toBeVisible();
  const latestObservation = page.getByText('Latest structured observation');
  await latestObservation.click();
  await expect(
    page
      .locator('details')
      .filter({ hasText: 'Latest structured observation' }),
  ).toContainText(customPersonality);
  await expect(worldMap).toHaveAttribute('data-rendered-h3-cell-count', '61');
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '1',
  );
  await expect(page.getByTestId('infected-count')).toHaveText(
    '1 rendered infected',
  );

  await page.getByRole('button', { name: 'Reset world' }).click();
  await expect(page.getByText('Turn 0')).toBeVisible();
  await expect(
    page.getByText(customPersonality, { exact: true }),
  ).toBeVisible();
  await expect(worldMap).toHaveAttribute('data-rendered-h3-cell-count', '61');
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '0',
  );
  await expect(page.getByTestId('infected-count')).toHaveText(
    '0 rendered infected',
  );
  await expect(markers).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(markers.nth(index)).toBeVisible();
  }
  await expect(
    page.getByText('Development world loaded with six agents.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByText('Turn 1', { exact: true })).toBeVisible();
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '1',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Restore default personalities' })
    .click();
  await expect(
    page.getByText(defaultPersonality, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Turn 1', { exact: true })).toBeVisible();
  await expect(worldMap).toHaveAttribute('data-rendered-h3-cell-count', '61');
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '1',
  );
  await expect(markers).toHaveCount(6);
  expect(openRouterRequests).toEqual([]);
});
