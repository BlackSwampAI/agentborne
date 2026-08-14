import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command:
        'AGENTBORNE_PROVIDER=scripted pnpm --filter @agentborne/game-api dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'NEXT_PUBLIC_GAME_API_BASE_URL=http://127.0.0.1:8787/api/simulation pnpm --filter @agentborne/world-lab dev',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
