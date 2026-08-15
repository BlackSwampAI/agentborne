# Architecture

Formal alliance experimentation preserves the existing one-way trust boundary:

```text
World Lab → Game API / simulation service → agent runtime → one decision
                                                        ↓
 snapshot / turn record ← independent world + communication + diplomacy validation
```

The Game API also owns one process-local experiment record. Each completed safe turn is captured once, independently from the browser snapshot, and server-side export levels filter that record without affecting provider requests.

## Applications

`apps/world-lab` is a Next.js App Router developer/admin surface. It fetches runtime-validated simulation snapshots through a local rewrite, controls one turn at a time, and updates MapLibre's existing H3 GeoJSON source without recreating the map. Agent markers are fully visible and use deterministic offsets when sharing cells.

`apps/game-api` is a Hono service bound conservatively to loopback. Its single in-memory `SimulationService` owns the development session, monotonic completed-turn count, turn cursor, bounded histories, and overlap lock. It exposes:

- `GET /api/simulation` — current authoritative snapshot
- `POST /api/simulation/turn` — one agent observation, one provider decision, one engine application
- `POST /api/simulation/reset` — deterministic reset, rejected while a turn is active
- `POST /api/simulation/agents/:agentId/personality` — trim, validate, and replace one active personality
- `POST /api/simulation/personalities/restore-defaults` — restore all eight milestone personality directives without resetting progress
- `POST /api/simulation/experiment/export/preview` — validate filters and report subset size, retention, cost, and approximate sharing tokens
- `POST /api/simulation/experiment/export` — construct one schema-versioned safe JSON document

The legacy `GET /api/development-world` and `GET /health` endpoints remain for low-level diagnostics.

The Game API is authoritative for session personality configuration. World reset reconstructs deterministic positions, 127 open cells, empty alliances/proposals/events/metrics, cursor, and completed-turn count, then reapplies the eight current personality values. Restoring defaults changes only those values. Both personality mutations are rejected while the service's turn lock is active.

## Turn flow

The development world is a deterministic H3 resolution-nine radius-six disk (127 cells) around Toledo with eight fixed profiles and unique perimeter starts. One agent acts per turn in stable array order, so 200 completed turns give every agent exactly 25 turns. The service makes exactly one structured provider request returning one required `worldAction`, zero or one `communication`, and zero or one `diplomacy` intent (`propose-alliance`, `accept-alliance`, or `leave-alliance`). There are no social ticks, background inference calls, or automatic replies.

Names, colors, stable IDs, and starting cells remain fixed. Personality text is mutable session configuration, but each observation copies the active value at turn start. Completed observations and turn records remain immutable, so a newly edited active personality can intentionally differ from the latest historical observation until that agent acts again.

The engine alone accepts or rejects all components and creates events. The service preserves the pre-decision state, then applies world action, communication, diplomacy, and automatic proposal expiry in that deterministic order. Direct-message eligibility uses the preserved pre-action state. Each rejected component leaves the others intact; malformed diplomacy is sanitized without retaining raw output. A wholly malformed root response follows the provider-failure path and applies none of its requested components. Provider-error turns still count and can deterministically expire proposals.

## Formal alliance state

World state owns up to four active alliances and bounded pending proposals. Alliance and proposal IDs are system-generated typed UUIDs. Each alliance contains two to eight unique agents, each agent belongs to at most one alliance, and the engine allocates the first free color from a fixed four-color accessible palette. A proposal records proposer, recipient, proposer alliance at creation, originating turn, and expiration turn. Created at turn `N`, it remains eligible through turn `N + 8` and expires after that turn without inference.

Free agents may propose only to free agents; allied agents may invite a free agent into their current alliance. Recipient-only acceptance either forms a two-agent alliance or recruits into the recorded unchanged alliance. Membership changes invalidate impossible proposals. Departure is unilateral; individual hex control never changes, and an alliance dissolves below two members. Hexes store only individual `controllerAgentId`; effective marker and territory color is derived from the controller's current alliance, or its permanent base color when unaffiliated. Capture eligibility rejects `allied-controller`.

Public communication is visible to every agent without a range check. Direct communication authoritatively trims and bounds text, requires a distinct existing recipient, and accepts inclusive pre-action H3 distances 0–3. Moving closer in the same decision cannot change eligibility. Accepted communications enter the bounded world-event stream; rejected attempts remain safe structured turn telemetry with a reason, sender, channel, recipient when applicable, nullable computed distance, timestamp, event ID, and trimmed text. No raw provider response is retained.

Snapshots keep the newest 120 turn records and 120 world events. Observations expose controller/alliance/effective-color data for current and adjacent cells, up to seven other agents, an eight-entry individual scoreboard, active alliance totals and member contributions, relevant proposals, at most eight chronological alliance events, six control changes, 12 public messages, and six relevant direct messages. These are bounded event-derived views, and all model-authored text remains untrusted subordinate context.

## Experiment telemetry and export

The active experiment has a runtime-validated UUID, start time, initial eight-agent configuration, immutable personality-change events, initial world, and up to 5,000 complete safe turns. The existing browser snapshot and world-event list remain capped at 120. Absolute numbering, first/last retained turns, dropped count, and completeness disclose truncation. Reset creates a new experiment and clears telemetry/cost while preserving active personalities; no previous experiments survive reset or process restart.

Metrics and filtering are deterministic Game API responsibilities. Historical metrics describe the filtered retained subset; current individual and alliance territory remain separate. Schema version 5 preserves action, communication, usage, cost, and retention metrics and adds diplomacy requested/accepted/rejected categories, proposal expiry/invalidation, formations, joins, departures, dissolutions, allied capture attempts, and per-agent multi-party relevance. A turn still belongs to its actor; communications retain sender/recipient semantics; alliance events are selected for every directly affected agent. Preview separately reports matching turns, communications, control changes, and diplomacy/alliance events. Initial/current worlds are state-only and include active alliances and proposals without event history.

The agent runtime follows [OpenRouter's usage-accounting contract](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and normalizes optional non-streaming usage fields: prompt, completion, total, reasoning, cached-read, cache-write tokens, and actual `usage.cost` as `costCredits`. It never derives price from a table. Safe usage already returned with a billable response is retained on later decision JSON/schema failure; network and HTTP failures without usage remain unknown. Scripted providers explicitly report zero tokens and zero cost.

## Packages

`packages/shared` owns centralized development limits and all public schemas, including typed alliances/proposals/diplomacy/results/events, alliance-aware observations and metrics, and schema-v5 exports. Types are inferred from Zod.

`packages/world-engine` remains deterministic and has no model, HTTP, UI, storage, or credential dependency. It validates world action, communication, and diplomacy independently and is the sole alliance mutation authority. Direct proximity is derived from a separately supplied pre-action state.

`packages/agent-runtime` contains the OpenRouter adapter. The configured model and existing default remain untouched and model IDs are never special-cased. One strict root-object JSON Schema request contains a four-way `worldAction` union plus nullable public/direct communication and three-way diplomacy unions. The bounded request still uses `max_tokens: 1024` with excluded low-effort reasoning. Zod and the world engine remain authoritative. Scripted and browser-test providers emit the same shape.

The provider abort timeout covers the complete response lifecycle, including body reading, JSON decoding, response extraction, and schema validation, and is cleared after every outcome. Non-success responses retain only bounded, sanitized in-process diagnostics for the opt-in CLI smoke; those details do not enter simulation records or API responses. Scripted providers are explicit deterministic seams selected only by tests or `AGENTBORNE_PROVIDER=scripted`; there is no automatic fallback.

The rationale and deferrals are recorded in [ADR 0002](adr/0002-first-visible-llm-invasion.md).
Personality ownership and reset semantics are recorded in [ADR 0003](adr/0003-session-personality-configuration.md).
Experiment capture and export semantics are recorded in [ADR 0004](adr/0004-server-owned-experiment-telemetry.md).
Nearby-message authority, observation bounds, and export selection semantics are recorded in [ADR 0005](adr/0005-nearby-agent-messaging.md).
Contested control, capture, territory authority, and schema-v3 selection semantics are recorded in [ADR 0006](adr/0006-contested-hex-control.md).
Decoupled communication and schema-v4 selection semantics are recorded in [ADR 0007](adr/0007-decoupled-world-communication.md).
Formal alliances, the expanded experiment, and schema-v5 semantics are recorded in [ADR 0008](adr/0008-formal-alliances-experiment.md).
