# Testing

Default validation is deterministic and offline except dependency/browser installation and optional basemap requests during browser rendering. No default test or GitHub Actions job contacts OpenRouter.

The repository owner runs local validation. Coding agents write tests and inspect GitHub CI but do not run local formatting, linting, type checking, tests, builds, Playwright, or real-provider calls unless explicitly asked.

## Owner validation sequence

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

`pnpm validate` aggregates formatting, lint, type checking, unit/integration tests, and builds. Playwright remains separate. Its web server starts both applications with the explicit deterministic provider; `AGENTBORNE_PROVIDER=scripted` is never an implicit OpenRouter fallback.

## Coverage

- Shared schema tests cover valid/invalid observations and decisions, all turn outcomes, response snapshots, history bounds, and model-authored string limits.
- World-engine tests cover adjacent and non-adjacent movement, infection persistence, repeated-infection rejection, wait, immutability on rejection, and deterministic 61-cell/six-agent construction.
- Agent-runtime tests inspect strict OpenRouter requests, prompt placement, parsing, runtime validation, malformed/unsupported responses, timeouts, sanitization, secret non-leakage, missing configuration, and explicit scripted output.
- Simulation-service tests cover deterministic reset, round robin, exactly one call per turn, latest-state observations, accepted/rejected/failure records, recovery, and turn/reset concurrency.
- API integration tests validate snapshot, turn, reset, missing configuration, provider failure, rejection, and typed conflict responses.
- React tests cover controls/statuses, playback configuration, single turn, reset, agent/hex selection, inspector output, H3 readiness, and safe configuration errors.
- Playwright verifies 61 visible H3 cells are reported ready, six markers, marker/inspector interaction, infection layer data changes, Start/Pause, reset, and the explicit automated-test provider.

## Real-provider smoke

The separately opted-in `pnpm smoke:openrouter` command makes one bounded OpenRouter call and validates the decision. It requires an exported `OPENROUTER_API_KEY`, incurs third-party cost, and is intentionally absent from `pnpm test`, `pnpm validate`, Playwright, and CI.
