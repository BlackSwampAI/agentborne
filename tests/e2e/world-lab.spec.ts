import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { experimentExportDocumentSchema } from '@agentborne/shared';

const ROOK_ID = '2507bb46-7ae4-45ca-8dda-644c4f85ca14';
const MINGLE_ID = '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5';
const MINGLE_PERSONALITY =
  'You are a social coalition-builder. Move toward visible agents, initiate and continue conversations, negotiate before taking their territory, and coordinate when useful. Infect open cells opportunistically, but value interaction over silent pursuit.';

test('runs the complete deterministic World Lab browser flow', async ({
  page,
}) => {
  const isolatedApiOrigin = process.env.PLAYWRIGHT_API_ORIGIN;
  if (isolatedApiOrigin) {
    await page.route('**/api/game/**', async (route) => {
      const original = new URL(route.request().url());
      const path = original.pathname.slice('/api/game'.length);
      await route.continue({
        url: `${isolatedApiOrigin}${path}${original.search}`,
      });
    });
  }
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
  await expect(worldMap).toHaveAttribute('data-controller-colors', '');
  await expect(page.getByText('No controller')).toBeVisible();
  await expect(page.getByLabel('Territory scoreboard')).toContainText('Rook0');
  await expect(page.getByLabel('Territory scoreboard')).toContainText(
    'Mingle0',
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
  await expect(page.getByText(/Message · Ember → Rook/)).toBeVisible();
  await expect(page.getByLabel('Recent communications')).toContainText(
    'Outbound Ember → Rook',
  );
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
    '0',
  );
  await expect(page.getByTestId('infected-count')).toHaveText(
    '0 rendered infected',
  );

  await page.getByRole('button', { name: 'Select agent Rook' }).click();
  await expect(page.getByLabel('Recent communications')).toContainText(
    'Inbound Ember → Rook',
  );
  await page.getByRole('button', { name: 'Single turn' }).click();
  const recipientObservation = page.getByText('Latest structured observation');
  await recipientObservation.click();
  await expect(
    page
      .locator('details')
      .filter({ hasText: 'Latest structured observation' }),
  ).toContainText('inbound: Ember → Rook');
  await expect(worldMap).toHaveAttribute('data-controller-colors', /#ffd166/);
  await expect(page.getByLabel('Territory scoreboard')).toContainText('Rook1');
  await expect(
    page
      .getByLabel('Selected hex inspector')
      .getByText('Rook', { exact: true }),
  ).toBeVisible();

  for (let index = 0; index < 6; index += 1)
    await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByLabel('Agent inspector')).toContainText('move →');

  let captured = false;
  for (let index = 0; index < 60 && !captured; index += 1) {
    await page.getByRole('button', { name: 'Single turn' }).click();
    captured = await page.getByText(/Mingle captured .* from Rook/).isVisible();
  }
  expect(captured).toBe(true);
  await expect(worldMap).toHaveAttribute('data-controller-colors', /#63d2ff/);
  await expect(page.getByLabel('Territory scoreboard')).toContainText('Rook0');
  await expect(page.getByLabel('Territory scoreboard')).toContainText(
    'Mingle1',
  );
  await page.getByRole('button', { name: 'Select agent Rook' }).click();
  await expect(page.getByLabel('Recent territory changes')).toContainText(
    'Lost',
  );
  await page.getByRole('button', { name: 'Select agent Mingle' }).click();
  await expect(page.getByLabel('Recent territory changes')).toContainText(
    'Gained',
  );
  await page.getByRole('button', { name: 'Select agent Rook' }).click();
  await page.getByRole('button', { name: 'Export this agent' }).click();
  await expect(page.getByRole('checkbox', { name: /Rook/ })).toBeChecked();
  for (const action of ['move', 'infect', 'message', 'wait']) {
    await page.getByRole('checkbox', { name: action, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByLabel('Export preview')).toContainText('0 records');
  await expect(page.getByLabel('Export preview')).toContainText('1 matched');
  await page.getByRole('button', { name: 'Generate JSON' }).click();
  await expect(page.getByText(/schema-validated/)).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const exported = experimentExportDocumentSchema.parse(
    JSON.parse(await readFile(downloadedPath!, 'utf8')),
  );
  expect(exported.schemaVersion).toBe(3);
  expect(exported.filters.level).toBe('minimal');
  expect(exported.selection.selectedAgentIds).toEqual([ROOK_ID]);
  expect(exported.turns).toEqual([]);
  expect(exported.controlChanges).toMatchObject([
    {
      controllerAgentId: MINGLE_ID,
      previousControllerAgentId: ROOK_ID,
    },
  ]);
  expect(exported.selection.matchingControlChangeCount).toBe(1);
  expect(exported.metrics?.byAgent[0]?.metrics).toMatchObject({
    totalTurns: 0,
    territoryLostThroughCapture: 1,
  });
  expect(exported.metrics?.aggregate.knownCostCredits).toBe(0);
  expect(exported.metrics?.aggregate.turnsWithUnknownCost).toBe(0);
  expect(exported.turns.map(({ turnNumber }) => turnNumber)).toEqual(
    exported.turns
      .map(({ turnNumber }) => turnNumber)
      .toSorted((a, b) => a - b),
  );

  page.once('dialog', (dialog) => dialog.accept());
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
  await expect(worldMap).toHaveAttribute('data-controller-colors', '');
  await expect(page.getByText('No controller')).toBeVisible();
  await expect(markers).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(markers.nth(index)).toBeVisible();
  }
  await expect(
    page.getByText('Development world loaded with six agents.'),
  ).toBeVisible();
  await expect(
    page.getByText('No communications for this agent yet.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByText('Turn 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/Message · Ember → Rook/)).toBeVisible();
  await page.getByRole('button', { name: 'Single turn' }).click();
  await expect(page.getByText('Turn 2', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Select agent Mingle' }).click();
  await expect(
    page.getByText(MINGLE_PERSONALITY, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Turn 2', { exact: true })).toBeVisible();
  await expect(worldMap).toHaveAttribute('data-rendered-h3-cell-count', '61');
  await expect(worldMap).toHaveAttribute(
    'data-rendered-infected-cell-count',
    '1',
  );
  await expect(markers).toHaveCount(6);
  expect(openRouterRequests).toEqual([]);
});
