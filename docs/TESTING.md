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
```

`pnpm validate` aggregates formatting, lint, type checking, unit/integration tests, and builds. Playwright remains separate. Its web server starts both applications with the explicit deterministic provider; `AGENTBORNE_PROVIDER=scripted` is never an implicit OpenRouter fallback.

## Coverage

- Shared schema tests cover valid/invalid observations and decisions, all turn outcomes, response snapshots, 120-record turn and 120-event history bounds, and model-authored string limits.
- Shared schema tests cover trimmed 1–280 character message actions, recipient IDs, typed accepted-message events, and six-entry directional observation bounds.
- Shared schema tests cover trimmed personality updates, empty/oversized/malformed values, update/restore response contracts, and typed mutation errors.
- Shared schema tests cover optional provider usage and tiny costs, experiment identities/manifests/retention/configuration events, all export levels and filters, Custom dependencies, invalid empty/range/agent selections, previews, generated documents, and level-specific omissions.
- World-engine tests cover adjacent and non-adjacent movement, infection persistence, repeated-infection rejection, wait, messaging at distances zero/one/three, distance-four/self/unknown rejection, exclusivity, immutability on rejection, and deterministic 61-cell/six-agent construction.
- Agent-runtime tests recursively inspect the actual strict OpenRouter schema and Gemini-compatible parameters, fixed message trust instructions, prompt placement, explicit model overrides, message parsing, runtime validation, malformed/empty/oversized/invalid-target responses, body-inclusive timeouts and timer cleanup, bounded safe HTTP diagnostics, secret non-leakage, missing configuration, and explicit scripted output.
- Agent-runtime tests normalize successful/missing reasoning/cache/token/cost usage, retain known usage through malformed or unsupported decisions, and prove scripted zero cost.
- Simulation-service tests cover deterministic reset, round robin beyond retained history, monotonic total turn numbering, exactly one call per turn, latest-state observations, six-message chronological context, 120-record turn retention, 120-event retention, accepted/rejected/failure records, reset clearing, atomic rollback on internal validation failure, recovery, and turn/reset concurrency.
- Simulation-service tests cover independent 5,000-versus-120 retention, configurable truncation, experiment identity/reset, immutable personality history, agent/range/outcome/action filtering, sender/recipient communication selection, rejected-message exclusion, every export tier, eventless spatial world snapshots with canonical filtered event/communication streams, Compact/Pretty byte estimates, artifact-free decimal cost aggregation, subset metrics, tiny/unknown costs, visitation/infection/message metrics, ordering, immutability, and export concurrency/recovery.
- Personality service tests cover single-agent updates, unknown/invalid rejection without mutation, next-observation use, preservation of progress and history, reset preservation, six-profile default restoration, active-turn conflicts, and recovery.
- API integration tests validate snapshot, turn, reset, missing configuration, provider failure, internal-failure propagation and recovery, rejection, and typed conflict responses.
- API integration tests validate personality update/default-restore success, boundary validation, unknown IDs, conflicts, and safe error/response bodies.
- API integration tests validate export preview/generation, unknown/empty/malformed selections, retention disclosure, typed conflicts, and safe-response exclusions.
- React tests cover controls/statuses, playback configuration, single turn, reset, agent/hex selection, inbound/outbound inspector communications, event-log messages, hostile-looking text escaping, H3 readiness, and safe configuration errors.
- React tests cover explicit edit/cancel/apply, every preset, Custom matching, character feedback, playback/pending disabling, reset preservation, restore confirmation, and active-versus-historical personality clarity.
- React tests cover experiment/agent usage, export agent selection, levels and Custom switches, filters, preview, copy/download identity and URL cleanup, reset telemetry warnings, and fully infected auto-pause.
- Playwright uses real MapLibre feature inspection and the explicit scripted provider to verify one accepted message, sender/recipient direction, recipient observation context, reset clearing, personality behavior, 61 unique rendered H3 cells, infection counts, and six markers.
- Playwright previews one agent, downloads and runtime-validates a recipient-scoped Minimal export containing the inbound communication and zero-cost metrics, then confirms no OpenRouter request occurred.

## Real-provider smoke

The separately opted-in `pnpm smoke:openrouter` command makes one bounded OpenRouter call and validates the decision. It is not part of the default owner validation sequence and must be run only when the owner deliberately opts into a charged provider smoke. Node 24's built-in environment parser reads only `OPENROUTER_API_KEY` and `AGENTBORNE_MODEL` from the repository-root `.env` for this command, and file values override stale exported values for the smoke process. A missing file still yields the sanitized missing-configuration failure. The call incurs third-party cost and is intentionally absent from `pnpm test`, `pnpm validate`, Playwright, and CI. On failure, the CLI may print only the bounded safe diagnostic fields retained by the adapter.
