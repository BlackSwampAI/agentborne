# Architecture

Decoupled world communication preserves the existing one-way trust boundary:

```text
World Lab → Game API / simulation service → agent runtime → one decision
                                                        ↓
       snapshot / turn record ← independent world + communication validation
```

The Game API also owns one process-local experiment record. Each completed safe turn is captured once, independently from the browser snapshot, and server-side export levels filter that record without affecting provider requests.

## Applications

`apps/world-lab` is a Next.js App Router developer/admin surface. It fetches runtime-validated simulation snapshots through a local rewrite, controls one turn at a time, and updates MapLibre's existing H3 GeoJSON source without recreating the map. Agent markers are fully visible and use deterministic offsets when sharing cells.

`apps/game-api` is a Hono service bound conservatively to loopback. Its single in-memory `SimulationService` owns the development session, monotonic completed-turn count, turn cursor, bounded histories, and overlap lock. It exposes:

- `GET /api/simulation` — current authoritative snapshot
- `POST /api/simulation/turn` — one agent observation, one provider decision, one engine application
- `POST /api/simulation/reset` — deterministic reset, rejected while a turn is active
- `POST /api/simulation/agents/:agentId/personality` — trim, validate, and replace one active personality
- `POST /api/simulation/personalities/restore-defaults` — restore all six original personality directives without resetting progress
- `POST /api/simulation/experiment/export/preview` — validate filters and report subset size, retention, cost, and approximate sharing tokens
- `POST /api/simulation/experiment/export` — construct one schema-versioned safe JSON document

The legacy `GET /api/development-world` and `GET /health` endpoints remain for low-level diagnostics.

The Game API is authoritative for session personality configuration. The browser never patches a snapshot locally: it displays only a schema-validated mutation response. World reset reconstructs deterministic positions, cells, histories, cursor, and completed-turn count, then reapplies the six current personality values. Restoring personality defaults changes only those six values. Both personality mutations are rejected while the service's turn lock is active.

## Turn flow

The development world is an H3 radius-four disk (61 cells) around Toledo with six fixed profiles and starting cells. All six personality strings remain unchanged. One agent acts per turn in stable array order. The service reads the latest state, constructs and clones a bounded observation, and makes exactly one structured provider request. A valid decision contains one required `worldAction` (`move`, `infect`, `capture`, or `wait`) and zero or one `communication` (`public` or `direct`). There are no social ticks, background inference calls, or automatic replies.

Names, colors, stable IDs, and starting cells remain fixed. Personality text is mutable session configuration, but each observation copies the active value at turn start. Completed observations and turn records remain immutable, so a newly edited active personality can intentionally differ from the latest historical observation until that agent acts again.

The engine alone accepts or rejects both components and creates world events. A hex remains a runtime-validated open/infected union with the existing infection and capture rules. The service captures the pre-action state, applies the world action, then evaluates communication eligibility against that captured state while appending an accepted communication after the action event. This gives deterministic action-then-communication ordering. A rejected component leaves the other component intact. Both result records share the turn number, provider metadata, decision summary, and single provider call. A wholly malformed provider response follows the existing sanitized provider-failure path and applies neither component.

Public communication is visible to every agent without a range check. Direct communication authoritatively trims and bounds text, requires a distinct existing recipient, and accepts inclusive pre-action H3 distances 0–3. Moving closer in the same decision cannot change eligibility. Accepted communications enter the bounded world-event stream; rejected attempts remain safe structured turn telemetry with a reason, sender, channel, recipient when applicable, nullable computed distance, timestamp, event ID, and trimmed text. No raw provider response is retained.

Only failures thrown by the provider decision call become sanitized provider-failure turn records. Those failures remain non-mutating, count as completed recorded turns, advance round robin, and do not prevent later turns. Snapshots keep the newest 120 turn records and 120 accepted world events. Observations expose controller data, capture eligibility, the territory scoreboard, eight non-communication public events, six relevant control changes, the latest 12 public messages, and the latest six direct messages where the observer is sender or recipient. Both windows are chronological; direct entries include participants and inbound/outbound direction. These are bounded event-derived views, and all message text remains untrusted subordinate context.

## Experiment telemetry and export

The active experiment has a runtime-validated UUID, start time, initial six-agent configuration, immutable personality-change events, initial world, and up to 5,000 complete safe turns. The existing browser snapshot and world-event list remain capped at 120. Absolute numbering, first/last retained turns, dropped count, and completeness disclose truncation. Reset creates a new experiment and clears telemetry/cost while preserving active personalities; no previous experiments survive reset or process restart.

Metrics and filtering are deterministic Game API responsibilities. Historical export metrics describe the filtered retained subset; current territory remains separate. Schema version 4 records requested/accepted world actions by type and independently records public requested/accepted/rejected plus direct requested/delivered/rejected totals. Per-agent metrics distinguish public sent, direct sent, and direct received. A turn is selected only through its actor and world-action/outcome filters. Communication selection is independent: all-agent exports include every matching communication; selected-agent exports include public messages authored by a selected agent and direct messages where a selected agent is sender or recipient. Unrelated direct conversations are excluded. Channel (`all`, `public`, `direct`) and status (`all`, `accepted`, `rejected`) are explicit filters. Absolute ranges apply by originating turn; latest communication selection uses the retained latest-turn window. Selected observations may retain the bounded public context that influenced those turns, but the canonical stream never duplicates the global feed merely because an observer was selected. Preview separately reports matching turn and communication counts. State-only initial/current worlds and all existing security exclusions remain unchanged.

The agent runtime follows [OpenRouter's usage-accounting contract](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and normalizes optional non-streaming usage fields: prompt, completion, total, reasoning, cached-read, cache-write tokens, and actual `usage.cost` as `costCredits`. It never derives price from a table. Safe usage already returned with a billable response is retained on later decision JSON/schema failure; network and HTTP failures without usage remain unknown. Scripted providers explicitly report zero tokens and zero cost.

## Packages

`packages/shared` owns all public schemas: profiles, controller-bearing hexes, personality mutations, observations, `worldAction`, optional communication intents, separate component results, public/direct events and attempts, provider metadata/failures, snapshots, telemetry, schema-v4 exports, and API responses. Types are inferred from Zod.

`packages/world-engine` remains deterministic and has no model, HTTP, UI, storage, or credential dependency. It validates the four world actions and optional communication independently. Direct proximity is derived from a separately supplied pre-action state. Existing capture presence rules remain unchanged.

`packages/agent-runtime` contains the OpenRouter adapter. The configured model and existing default remain untouched and model IDs are never special-cased. One strict root-object JSON Schema request contains a four-way `worldAction` union and nullable public/direct communication union. The bounded request still uses `max_tokens: 1024` with excluded low-effort reasoning. Zod and the world engine remain authoritative. Scripted and browser-test providers emit the same decoupled shape.

The provider abort timeout covers the complete response lifecycle, including body reading, JSON decoding, response extraction, and schema validation, and is cleared after every outcome. Non-success responses retain only bounded, sanitized in-process diagnostics for the opt-in CLI smoke; those details do not enter simulation records or API responses. Scripted providers are explicit deterministic seams selected only by tests or `AGENTBORNE_PROVIDER=scripted`; there is no automatic fallback.

The rationale and deferrals are recorded in [ADR 0002](adr/0002-first-visible-llm-invasion.md).
Personality ownership and reset semantics are recorded in [ADR 0003](adr/0003-session-personality-configuration.md).
Experiment capture and export semantics are recorded in [ADR 0004](adr/0004-server-owned-experiment-telemetry.md).
Nearby-message authority, observation bounds, and export selection semantics are recorded in [ADR 0005](adr/0005-nearby-agent-messaging.md).
Contested control, capture, territory authority, and schema-v3 selection semantics are recorded in [ADR 0006](adr/0006-contested-hex-control.md).
Decoupled communication and schema-v4 selection semantics are recorded in [ADR 0007](adr/0007-decoupled-world-communication.md).
