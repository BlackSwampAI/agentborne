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

- Shared schema tests cover valid/invalid observations and decoupled decisions, required four-way world actions, optional public/direct communication, separate component results, all turn outcomes, response snapshots, history bounds, and model-authored string limits.
- Shared schema tests cover authoritative whitespace trimming and 1/280/281-character boundaries, recipient IDs, typed public/direct events and rejected attempts, 12-entry public and six-entry directional direct observation bounds.
- Shared schema tests cover open/uncontrolled and infected/controlled hex unions, controller validity, capture actions/events/rejections, bounded capture eligibility, territory scoreboards, gain/loss bounds, independent communication metrics/filters, and export schema version 4.
- Shared schema tests cover trimmed personality updates, empty/oversized/malformed values, update/restore response contracts, and typed mutation errors.
- Shared schema tests cover optional provider usage and tiny costs, experiment identities/manifests/retention/configuration events, all export levels and filters, Custom dependencies, invalid empty/range/agent selections, previews, generated documents, and level-specific omissions.
- World-engine tests cover all existing movement/infection/capture behavior plus public delivery, direct distances zero/one/three, distance-four/self/unknown rejection, message trimming, independent application, pre-action proximity, event ordering, and deterministic construction with unchanged personalities.
- Agent-runtime tests recursively inspect the strict model-agnostic OpenRouter schema, fixed trust and pre-action proximity instructions, one-call decision parsing, optional communication, explicit model overrides, malformed whole decisions, body-inclusive timeouts, bounded diagnostics, secret non-leakage, and updated scripted/mock output.
- Agent-runtime tests normalize successful/missing reasoning/cache/token/cost usage, retain known usage through malformed or unsupported decisions, and prove scripted zero cost.
- Simulation-service tests cover valid action plus public/direct messages, rejected action plus accepted public/direct messages, valid action plus rejected direct messages, pre-action distance, public visibility, direct privacy, chronological 12/6 windows, one call per turn, deterministic ordering, provider-failure no-effects behavior, reset clearing both channels/metrics, existing world behavior, retention, recovery, and concurrency.
- Export/telemetry tests cover independent world and communication totals, per-agent public sent/direct sent/direct received, all/one/multi-agent selection, unrelated-direct exclusion, accepted/rejected and public/direct filters, separate preview counts, schema-v4 validation, retained observation context without global-feed duplication, capture victim semantics, state-only snapshots, byte estimates, costs, ordering, and immutability.
- Personality service tests cover single-agent updates, unknown/invalid rejection without mutation, next-observation use, preservation of progress and history, reset preservation, six-profile default restoration, active-turn conflicts, and recovery.
- API integration tests validate snapshot, turn, reset, missing configuration, provider failure, internal-failure propagation and recovery, rejection, and typed conflict responses.
- API integration tests validate personality update/default-restore success, boundary validation, unknown IDs, conflicts, and safe error/response bodies.
- API integration tests validate export preview/generation, unknown/empty/malformed selections, retention disclosure, typed conflicts, and safe-response exclusions.
- React tests cover controls/statuses, playback, reset, selection, existing capture/territory views, a bounded public feed, direct sent/received history with participants and turn/time, visibly separate component results, empty states, hostile-looking text escaping, H3 readiness, and safe errors.
- React tests cover explicit edit/cancel/apply, every preset, Custom matching, character feedback, playback/pending disabling, reset preservation, restore confirmation, and active-versus-historical personality clarity.
- React tests cover experiment/agent usage, export agent selection, levels and Custom switches, filters, preview, copy/download identity and URL cleanup, reset telemetry warnings, and fully infected auto-pause.
- Playwright uses real MapLibre feature inspection and the explicit scripted provider to prove one inference can infect and directly communicate during the same turn, then verifies direct history, capture, controller transfer, export, reset clearing, unchanged personality behavior, 61 H3 cells, infection counts, and six markers.
- Playwright previews and runtime-validates a victim-only Minimal capture export with zero matching victim capture turns and one matching control change, verifies zero-cost metrics, then confirms no OpenRouter request occurred.
- The explicit scripted server path does not load `.env`; genuine-provider environment loading remains outside deterministic browser validation.

## Real-provider smoke

The separately opted-in `pnpm smoke:openrouter` command makes one bounded OpenRouter call and validates the decision. It is not part of the default owner validation sequence and must be run only when the owner deliberately opts into a charged provider smoke. Node 24's built-in environment parser reads only `OPENROUTER_API_KEY` and `AGENTBORNE_MODEL` from the repository-root `.env` for this command, and file values override stale exported values for the smoke process. A missing file still yields the sanitized missing-configuration failure. The call incurs third-party cost and is intentionally absent from `pnpm test`, `pnpm validate`, Playwright, and CI. On failure, the CLI may print only the bounded safe diagnostic fields retained by the adapter.
