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
pnpm exec playwright install chromium  # only if Chromium is not already installed
pnpm test:e2e
pnpm smoke:openrouter
```

`pnpm validate` aggregates formatting, lint, type checking, unit/integration tests, and builds. Playwright remains separate. Its web server starts both applications with the explicit deterministic provider; `AGENTBORNE_PROVIDER=scripted` is never an implicit OpenRouter fallback.

## Coverage

- Shared schema tests cover valid/invalid observations and decisions, all turn outcomes, response snapshots, 120-record turn and 120-event history bounds, and model-authored string limits.
- Shared schema tests cover trimmed personality updates, empty/oversized/malformed values, update/restore response contracts, and typed mutation errors.
- World-engine tests cover adjacent and non-adjacent movement, infection persistence, repeated-infection rejection, wait, immutability on rejection, and deterministic 61-cell/six-agent construction.
- Agent-runtime tests recursively inspect the actual strict OpenRouter schema and Gemini-compatible parameters, prompt placement, explicit model overrides, parsing, runtime validation, malformed/unsupported responses, body-inclusive timeouts and timer cleanup, bounded safe HTTP diagnostics, secret non-leakage, missing configuration, and explicit scripted output.
- Simulation-service tests cover deterministic reset, round robin beyond retained history, monotonic total turn numbering, exactly one call per turn, latest-state observations, 120-record turn retention, 120-event retention, accepted/rejected/failure records, atomic rollback on internal validation failure, recovery, and turn/reset concurrency.
- Personality service tests cover single-agent updates, unknown/invalid rejection without mutation, next-observation use, preservation of progress and history, reset preservation, six-profile default restoration, active-turn conflicts, and recovery.
- API integration tests validate snapshot, turn, reset, missing configuration, provider failure, internal-failure propagation and recovery, rejection, and typed conflict responses.
- API integration tests validate personality update/default-restore success, boundary validation, unknown IDs, conflicts, and safe error/response bodies.
- React tests cover controls/statuses, playback configuration, single turn, reset, agent/hex selection, inspector output, H3 readiness, and safe configuration errors.
- React tests cover explicit edit/cancel/apply, every preset, Custom matching, character feedback, playback/pending disabling, reset preservation, restore confirmation, and active-versus-historical personality clarity.
- Playwright uses real MapLibre feature inspection and the explicit scripted provider to verify personality mutation through the UI/API, next-observation use, reset preservation, default restoration without progress loss, 61 unique rendered H3 cells, infection counts, and six markers.

## Real-provider smoke

The separately opted-in `pnpm smoke:openrouter` command makes one bounded OpenRouter call and validates the decision. Node 24's built-in environment parser reads only `OPENROUTER_API_KEY` and `AGENTBORNE_MODEL` from the repository-root `.env` for this command, and file values override stale exported values for the smoke process. A missing file still yields the sanitized missing-configuration failure. The call incurs third-party cost and is intentionally absent from `pnpm test`, `pnpm validate`, Playwright, and CI. On failure, the CLI may print only the bounded safe diagnostic fields retained by the adapter.
