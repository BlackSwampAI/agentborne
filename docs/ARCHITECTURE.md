# Architecture

Contested hex control preserves the existing one-way trust boundary:

```text
World Lab → Game API / simulation service → agent runtime → requested action
                                                        ↓
                      snapshot / turn record ← world engine validation
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

The development world is an H3 radius-four disk (61 cells) around Toledo with six fixed profiles and starting cells. Mingle's default is intentionally social and negotiation-oriented; the other five defaults retain their prior behavior. One agent acts per turn in stable array order. The service reads the latest state, constructs and clones a bounded observation, requests one structured decision, validates it with Zod, and passes only the requested action to the world engine. Move, infect, capture, message, and wait are mutually exclusive turn actions.

Names, colors, stable IDs, and starting cells remain fixed. Personality text is mutable session configuration, but each observation copies the active value at turn start. Completed observations and turn records remain immutable, so a newly edited active personality can intentionally differ from the latest historical observation until that agent acts again.

The engine alone accepts or rejects actions and creates world events. A hex is a runtime-validated union: open with a null controller, or infected with one valid world-agent controller. Infection changes the open current hex to infected under the acting agent. Capture requires an infected current hex controlled by another agent whose controller is absent and transfers only its controller; it never moves either agent or changes the infected count. For messages the engine trims and bounds content, verifies a distinct existing recipient, calculates the beginning-of-turn H3 distance, and accepts only distance zero through three. Accepted messages do not change positions or infection and append one typed event with sender, recipient, text, timestamp, and distance. Rejections do not mutate state and are not replaced by heuristics. The service schema-validates a complete accepted or rejected turn record before atomically committing its candidate world state, turn record, completed-turn count, and round-robin cursor. Unexpected engine, schema, or internal failures propagate as internal API errors and commit none of those changes; cleanup always returns the service to a coherent idle state.

Only failures thrown by the provider decision call become sanitized provider-failure turn records. Those failures remain non-mutating, count as completed recorded turns, advance round robin, and do not prevent later turns. The public turn number is the total completed-turn count and is independent of the retained history: snapshots keep only the newest 120 turn records and newest 120 world events. Observations expose controller data on the current and adjacent hexes, server-authoritative current capture eligibility, an authoritative six-agent controlled-cell scoreboard, the newest eight non-message public events, at most six captures involving the observer, and at most six accepted messages involving the observer. Eligibility distinguishes open, self-controlled, controller-present, and abandoned enemy-controlled current cells. Control changes and communications remain chronological with explicit relative direction and participants. These are bounded views derived from authoritative state and events, not relationship or generic memory systems.

## Experiment telemetry and export

The active experiment has a runtime-validated UUID, start time, initial six-agent configuration, immutable personality-change events, initial world, and up to 5,000 complete safe turns. The existing browser snapshot and world-event list remain capped at 120. Absolute numbering, first/last retained turns, dropped count, and completeness disclose truncation. Reset creates a new experiment and clears telemetry/cost while preserving active personalities; no previous experiments survive reset or process restart.

Metrics and filtering are deterministic Game API responsibilities. Historical export metrics describe the filtered retained subset; the six current authoritative controlled-cell totals are exposed separately. Decimal-string accumulation prevents binary floating-point artifacts in aggregate provider cost while retaining tiny charges. Control and capture change hex state, actions, observations, events, metrics, and selection semantics, so generated documents use export schema version 3. Minimal and Standard provide progressively more turn context, Full safe includes the richest safe structured record and world/configuration context, and Custom applies validated inclusion dependencies. A turn is selected only through its actor. An accepted communication is relevant to sender and recipient, while a successful capture is relevant to capturer and displaced controller. Outcome, action, absolute range, latest-count, and retention rules apply to each originating turn. This permits a victim-only capture export with zero matching actor turns and a nonzero matching-control-change count. Rejected messages and captures remain only actor turns and never enter canonical successful-event streams. Full-safe initial/current world states retain all agents and controller-bearing hex states for spatial context but deliberately omit event history. The top-level `communications` and `controlChanges` streams are canonical; Full safe's `worldEvents` excludes both to avoid duplication. Compact JSON is the AI-sharing default and Pretty JSON is available for human review. Preview serializes the same prospective document with the selected encoding and estimates AI input as `ceil(UTF-8 bytes / 4)` without a tokenizer dependency.

The agent runtime follows [OpenRouter's usage-accounting contract](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and normalizes optional non-streaming usage fields: prompt, completion, total, reasoning, cached-read, cache-write tokens, and actual `usage.cost` as `costCredits`. It never derives price from a table. Safe usage already returned with a billable response is retained on later decision JSON/schema failure; network and HTTP failures without usage remain unknown. Scripted providers explicitly report zero tokens and zero cost.

## Packages

`packages/shared` owns all public schemas: profiles, controller-bearing hexes, personality mutation requests/responses, observations, turn decisions, message/control events, provider metadata/failures, turn outcomes, snapshots, telemetry, exports, and API responses. Types are inferred from Zod. The public action union is named for turn actions rather than map-only actions.

`packages/world-engine` remains deterministic and has no model, HTTP, UI, storage, or credential dependency. It authoritatively validates all five turn actions, including fixed distance-three messaging and current-cell capture only when the previous controller is absent. Presence is derived from current agent positions; unrelated occupants do not defend a cell. This prevents immediate same-cell control ping-pong without adding combat, cooldowns, or forced movement.

`packages/agent-runtime` contains the OpenRouter adapter. The interactive provider defaults to `google/gemini-3.7-flash`, uses one strict root-object JSON Schema request with a nested `anyOf` action union and single-value discriminator enums, and requires provider parameter support. The bounded request uses `max_tokens: 1024` plus low-effort reasoning excluded from the response; it does not request, retain, or expose reasoning content. Zod and the world engine remain authoritative for detailed string, H3, action, adjacency, infection-state, and consequence validation.

The provider abort timeout covers the complete response lifecycle, including body reading, JSON decoding, response extraction, and schema validation, and is cleared after every outcome. Non-success responses retain only bounded, sanitized in-process diagnostics for the opt-in CLI smoke; those details do not enter simulation records or API responses. Scripted providers are explicit deterministic seams selected only by tests or `AGENTBORNE_PROVIDER=scripted`; there is no automatic fallback.

The rationale and deferrals are recorded in [ADR 0002](adr/0002-first-visible-llm-invasion.md).
Personality ownership and reset semantics are recorded in [ADR 0003](adr/0003-session-personality-configuration.md).
Experiment capture and export semantics are recorded in [ADR 0004](adr/0004-server-owned-experiment-telemetry.md).
Nearby-message authority, observation bounds, and export selection semantics are recorded in [ADR 0005](adr/0005-nearby-agent-messaging.md).
Contested control, capture, territory authority, and schema-v3 selection semantics are recorded in [ADR 0006](adr/0006-contested-hex-control.md).
