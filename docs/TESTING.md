# Testing

Focused deterministic coverage includes physical-distance messaging across H3 resolutions, the eight-agent observation cap, alliance long-range visibility and delivery, channel privacy, seeded move-affordance ordering, effective neutral/alliance colors, and operator-only private-feed filters. Provider tests remain offline and use the flat `text-flat-json-v2` contract.

Operator-workspace component coverage verifies that Live/Agents switching preserves the mounted execution state, agent selection routes to the semantic inspector, Scoreboard remains directly reachable, and failure/recovery activity stays bounded. Playwright exercises the persistent command bar, workspace navigation, contextual inspector tabs, tabbed activity dock, overflow-routed setup/export actions, and desktop/narrow viewport containment. These tests continue to use only the deterministic provider.

Configurable-scenario coverage is deterministic and offline: `world-scenario-v1`, temporary roster/world limits, actual H3 count and area, radius presets, seeded identities and separated spawns, default compatibility, infeasibility, pure preview, atomic apply/current-scenario reset, dynamic assignment reconciliation, density warnings, and schema-v9 attribution. Geocoding uses injected fakes; browser coverage retains the default flow and adds a 469-cell/12-agent scenario flow.

Unattended-recovery coverage uses deterministic providers and timers to distinguish initial/internal/manual/unattended attempts, successful recovery, bounded exhaustion and one skip, run-target preservation, pause/cancel behavior, ineligible failures, reconciliation, idempotency, and browser-local controls. No live provider call is made.

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

Deterministic service and component coverage includes engine-derived action
availability, one-slot automatic repair/transport recovery under a shared
deadline, exact one-call manual Retry/Skip state, attempt-history export,
idempotent mutation delivery, ambiguous-response reconciliation, mutually
exclusive intervention controls, and model and export modal dismissal.

World Lab interaction coverage also verifies newest-first public-chat DOM order
and reading-position preservation, browser-local follow-turn selection across
active/next and recovery transitions, non-color acting/next labels, shared
dialog focus/dismissal/overflow structure, and complete collapsed dock headers.
Playwright exercises the map-first layout at 1920×1080, 1440×900, 1024×768,
and approximately 768×900 with deterministic scripted data only.

Command-navbar coverage verifies one persistent row, always-visible known cost, stable async control slots, accessible icon controls, exact absolute run targets through 1,000, current/past target disablement, hover/focus experiment details, responsive overflow, and removal of the provider badge and inspector export action. Map interaction coverage keeps agent-marker inspection independent from explicit hex selection and verifies that the map-local hex card dismisses on a background click. Export coverage separates preview from generation, invalidates artifacts after relevant option changes, prevents stale or duplicate copy/download, and checks accessible pending/ready/error states. Shared model-option tests require identical global/per-agent ordering and formatting. Effective-color tests cover current-alliance, retained, base, and neutral fallback precedence. Dark-map tests assert tokenless CARTO URLs and complete attribution without network access.

Behavior coverage verifies registry uniqueness/versioning, deterministic balanced and fully random assignment, independent profile dimensions, turn-one locking, reset semantics, exact diplomacy affordances, layered prompt trust language, bounded structural detail codes, turn attribution, and export preservation. Agent Controller coverage verifies accessible Overview/Models/Behavior tabs, default readiness, manual pre-turn selection, post-start locking, responsive dialog layout, and compact roster summaries.

Schema-v8 reconciliation tests require personality and strategy subtotals to match global logical-turn totals and verify that repaired validation attempts retain both `invalid-action-fields` and their stable structural detail code. The conversational-invitation regression expects contradictory diplomacy fields when a model supplies a chat participant as the recipient while omitting the required formal proposal ID. A well-formed but unavailable proposal UUID remains an engine-authoritative, non-retried rejection.

Attempt-accounting coverage verifies that schema-v7 metrics count every initial,
automatic-repair, automatic-transport-retry, and manual-retry call exactly once,
reconcile logical outcomes independently,
fall back once to top-level provider metadata for legacy records, and preserve
schema-v6 model-configuration import compatibility.

Partial-accounting fixtures verify independent known token-field sums,
unknown-token attempt disclosure, exact known-cost accumulation, and distinct
unknown-cost attempt versus logical-turn counts. Fake-timer transport tests cover
valid `Retry-After`, the bounded missing/invalid-header fallback, shared-deadline
consumption, cancellation during backoff, and the unchanged two-call ceiling.

- Centralized development-contract tests prove radius 6 produces exactly 127 unique open/uncontrolled cells, eight unique deterministic starts, stable IDs/default personalities, and an eight-entry scoreboard with up to seven other-agent observations.
- Alliance engine tests cover free-agent formation, recruitment, recipient-only acceptance, proposal conflicts and one-round expiry, stale invalidation, one-alliance membership, unilateral departure/dissolution, unchanged individual control, deterministic color reuse, and allied-capture rejection.
- Simulation tests cover independent world/communication/diplomacy outcomes, provider-error world preservation, bounded authoritative alliance observations, reset/default semantics, multi-agent telemetry relevance, alliance territory sums, and exactly 25 turns per agent after 200 completed turns.
- Runtime mocks cover the explicit per-turn model and reasoning profile, universal text-only request, flat JSON extraction/repair, exact default/off/effort payloads, absent provider-specific controls, malformed or missing output, cancellation, output exhaustion, metadata preservation, and the unchanged one-request boundary without OpenRouter calls.
- Catalog fixtures cover required-capability inclusion/exclusion, text modalities, context floor, pricing parsing, malformed entries, timeout/failure, cache TTL, stale fallback, manual refresh, and credential non-disclosure without network access.
- Schema-v5 export tests cover eight-agent selection, state-only alliance/proposal snapshots, diplomacy/event metrics and preview counts, selected-agent proposal/membership relevance, unrelated direct/rejected exclusion, cost handling, retention, and all four safe tiers.
- React and Playwright fixtures cover 127 MapLibre cells, eight markers, base/effective colors, alliance panels and events, separate component results, safe text rendering, reset, and exact browser-owned pause at turn 200 without a genuine-provider run.

- Shared schema tests cover valid/invalid observations and decoupled decisions, required four-way world actions, optional public/direct communication, separate component results, all turn outcomes, response snapshots, history bounds, and model-authored string limits.
- Shared schema tests cover authoritative whitespace trimming and 1/280/281-character boundaries, recipient IDs, typed public/direct events and rejected attempts, 12-entry public and six-entry directional direct observation bounds.
- Shared schema tests cover open/uncontrolled and infected/controlled hex unions, controller validity, alliance-aware capture eligibility, territory scoreboards, gain/loss bounds, independent communication/diplomacy metrics, and export schema version 5.
- Shared schema tests cover trimmed personality updates, empty/oversized/malformed values, update/restore response contracts, and typed mutation errors.
- Shared schema tests cover optional provider usage and tiny costs, experiment identities/manifests/retention/configuration events, all export levels and filters, Custom dependencies, invalid empty/range/agent selections, previews, generated documents, and level-specific omissions.
- World-engine tests cover all existing movement/infection/capture behavior plus public delivery, direct distances zero/one/three, distance-four/self/unknown rejection, message trimming, independent application, pre-action proximity, event ordering, and deterministic construction with unchanged personalities.
- Agent-runtime tests inspect the model-agnostic OpenRouter text request, fixed trust instructions, flat sentinel normalization, fenced/prose-wrapped/trailing-comma JSON recovery, exact metadata-selected reasoning payloads, explicit model overrides, body-inclusive 75-second timeouts, cancellation, bounded diagnostics, secret non-leakage, and provider-name-independent mocked output.
- Agent-runtime tests normalize successful/missing reasoning/cache/token/cost usage, retain known usage through malformed or unsupported decisions, and prove scripted zero cost.
- Simulation-service tests cover valid action plus public/direct messages, rejected action plus accepted public/direct messages, pre-action distance, one call per turn, provider-failure auto-stop semantics, cancellation without world mutation or turn consumption, global/per-agent model and reasoning resolution, exported profile change events, older-export defaults, retention, recovery, and concurrency.
- Export/telemetry tests cover independent world, communication, and diplomacy totals, multi-agent alliance relevance, malformed identifier sanitization, all/one/multi-agent selection, unrelated-direct and unrelated-rejection exclusion, separate preview counts, schema-v5 validation, state-only snapshots, byte estimates, costs, ordering, and immutability.
- Personality service tests cover single-agent updates, unknown/invalid rejection without mutation, next-observation use, preservation of progress and history, reset preservation, eight-profile default restoration, active-turn conflicts, and recovery.
- API integration tests validate snapshot, turn, reset, missing configuration, provider failure, internal-failure propagation and recovery, rejection, and typed conflict responses.
- API integration tests validate personality update/default-restore success, boundary validation, unknown IDs, conflicts, and safe error/response bodies.
- API integration tests validate export preview/generation, unknown/empty/malformed selections, retention disclosure, typed conflicts, and safe-response exclusions.
- React tests cover controls/statuses, playback, reset, selection, existing capture/territory views, a bounded public feed, direct sent/received history with participants and turn/time, visibly separate component results, empty states, hostile-looking text escaping, H3 readiness, and safe errors.
- React tests cover explicit edit/cancel/apply, every preset, Custom matching, character feedback, playback/pending disabling, reset preservation, restore confirmation, and active-versus-historical personality clarity.
- React tests cover experiment/agent usage, export agent selection, levels and Custom switches, filters, preview, copy/download identity and URL cleanup, reset telemetry warnings, and fully infected auto-pause.
- Playwright uses real MapLibre feature inspection and the explicit scripted provider to verify combined decision components, capture/controller transfer, alliance presentation, export/reset behavior, 127 H3 cells, infection counts, and eight markers.
- Playwright previews and runtime-validates a victim-only Minimal capture export with zero matching victim capture turns and one matching control change, verifies zero-cost metrics, then confirms no OpenRouter request occurred.
- The explicit scripted server path does not load `.env`; genuine-provider environment loading remains outside deterministic browser validation.

## Real-provider smoke

The separately opted-in `pnpm smoke:openrouter -- <compatible-model-slug>` command makes one bounded OpenRouter call and validates the decision. It reads only `OPENROUTER_API_KEY` from `.env`; the model is an explicit argument. It is intentionally absent from default validation, Playwright, and CI and must not be run without deliberate authorization because it incurs third-party cost.

World Lab also offers an explicit “Test selected model” probe. It uses the production text/flat-JSON contract and selected reasoning profile, does not advance or mutate the world, may incur a small charge, and is cached by model plus profile plus contract version. It is never invoked by deterministic validation or CI.
