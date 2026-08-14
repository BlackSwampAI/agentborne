# Testing

Default validation is deterministic, offline except for dependency/browser installation and the World Lab basemap requested during manual viewing. No test calls a model provider.

## Local sequence

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright starts the World Lab on port 3000 by default. To reuse an existing
development server on another port, run for example
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 pnpm test:e2e`.

`pnpm validate` aggregates formatting, lint, type checking, unit/integration tests, and builds. Browser smoke coverage remains separate because it installs and starts Chromium.

## Layers

- Shared schema unit tests cover the four allowed requested-action forms and reject invented verbs.
- World-engine unit tests cover H3 adjacency, movement validation, infection validation, immutable state transitions, and event production.
- Agent-runtime unit tests cover deterministic scripted-provider output and configuration failure.
- API integration tests call the Hono application in memory and validate health, snapshot, and error responses.
- React Testing Library checks the World Lab shell and hex-selection behavior in jsdom.
- Playwright starts the World Lab automatically and checks the browser-visible map shell, controls reservation, inspector reservation, and event log.

## External services

No default test may contact a model, database, map tile service, or game API process. The browser smoke test does not assert tile delivery; MapLibre may request public OpenStreetMap development tiles after the shell loads. Future real-provider tests must be explicitly opted into and must never join the default `pnpm test` or CI path.
