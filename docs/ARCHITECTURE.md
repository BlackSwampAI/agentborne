# Architecture

## Persistent World Lab operator shell

World Lab owns one browser execution controller at the root of its client component. The controller centralizes authoritative snapshot reconciliation, mutation IDs, playback timing, bounded-run targets, cancellation, and unattended recovery. Switching between the Live and Agents workspaces changes only the presented workspace; it does not unmount or duplicate the controller, its timer, or its in-flight request state.

The Live workspace is a grid of independently scrolling agent rail, map, contextual inspector, and bounded activity dock. Agent and hex selections select the corresponding semantic inspector tab, while Scoreboard and Run remain directly reachable. The Agents workspace reuses the same snapshot and existing server mutations for model, reasoning, personality, and strategy assignment. Roster replacement remains a World Setup operation that creates a replacement experiment rather than mutating the active roster mid-run.

Formal alliance experimentation preserves the existing one-way trust boundary:

```text
World Lab → Game API / simulation service → agent runtime → one decision
                                                        ↓
 snapshot / turn record ← independent world + communication + diplomacy validation
```

The Game API also owns one process-local experiment record. Each completed safe turn is captured once, independently from the browser snapshot, and server-side export levels filter that record without affecting provider requests.

World Setup uses `world-scenario-v1`. Pure preview computes the actual H3 disk, exact count, summed cell area, deterministic roster/spawns, feasibility, and warnings. Apply recomputes and atomically replaces world and experiment state. Reset reconstructs the current scenario; the Toledo default preserves legacy starts. Explicit location search crosses a replaceable server-owned adapter with no autocomplete, a one-request-per-second Nominatim limit, bounded cache/timeout, normalized results, and OpenStreetMap attribution. Manual coordinates bypass that network boundary.

World Lab may opt into browser-driven unattended recovery for continuous Start or Run-to sessions. After the existing initial call and at most one internal repair/transport retry, the browser serially requests one-call unattended retries up to a local limit of one through three, then commits one attributed unattended skip. Every mutation has a fresh idempotency key and uses the authoritative pending turn. Pausing, cancellation, ineligible failures, or failed reconciliation stops the loop. The tab must remain open; this is not scheduling, simultaneous ticks, or a production recovery service.

## Applications

`apps/world-lab` is a Next.js App Router developer/admin surface. It fetches runtime-validated simulation snapshots through a local rewrite, controls one turn at a time, and updates MapLibre's existing H3 GeoJSON source without recreating the map. Agent markers are fully visible and use deterministic offsets when sharing cells.

Its command navbar is the single persistent application-control row. Browser-session run-target selection remains client orchestration and preserves absolute turn semantics; execution and reconciliation still consume authoritative API snapshots. Global and per-agent selectors share one deduplicating, case-insensitive model-option builder. Current alliance membership is the first UI color authority for map, roster, chat, and log accents, followed by retained effective color, base agent color, and a neutral fallback.

The default basemap is tokenless CARTO Dark Matter with OpenStreetMap and CARTO attribution. Deterministic tests inspect its configuration and mocked MapLibre H3 sources without requesting external tiles.

Communication resolves against the authoritative pre-action snapshot. Public chat is globally observable and future-player-visible. Direct messages use H3-center great-circle distance and the scenario's bounded kilometer range. Alliance messages are private to current members regardless of distance. World Lab may inspect private traffic; player-facing contracts must not include that omniscient feed. Equivalent legal moves are ordered reproducibly from world seed, stable agent ID, and logical turn without process randomness.

`apps/game-api` is a Hono service bound conservatively to loopback. Its single in-memory `SimulationService` owns the development session, monotonic completed-turn count, turn cursor, bounded histories, and overlap lock. It exposes:

- `GET /api/simulation` — current authoritative snapshot
- `POST /api/simulation/turn` — one agent observation, one provider decision, one engine application
- `POST /api/simulation/reset` — deterministic reset, rejected while a turn is active
- `POST /api/simulation/agents/:agentId/personality` — trim, validate, and replace one active personality
- `POST /api/simulation/personalities/restore-defaults` — restore all eight milestone personality directives without resetting progress
- `POST /api/simulation/experiment/export/preview` — validate filters and report subset size, retention, cost, and approximate sharing tokens
- `POST /api/simulation/experiment/export` — construct one schema-versioned safe JSON document
- `GET /api/simulation/models` — return the cached, sanitized compatible model catalog
- `POST /api/simulation/models/refresh` — explicitly refresh that catalog
- `POST /api/simulation/models/verify` — make one explicit, non-mutating compatibility probe
- `POST /api/simulation/experiment/models` — replace the unlocked global/per-agent assignment
- `POST /api/simulation/turn/cancel` — abort the active provider request without mutating the world or consuming a turn
- `POST /api/simulation/experiment/import` — restore model assignments from a validated export

The legacy `GET /api/development-world` and `GET /health` endpoints remain for low-level diagnostics.

The Game API is authoritative for session personality configuration. World reset reconstructs deterministic positions, 127 open cells, empty alliances/proposals/events/metrics, cursor, and completed-turn count, then reapplies the eight current personality values. Restoring defaults changes only those values. Both personality mutations are rejected while the service's turn lock is active.

## Turn flow

Recoverable provider, parsing, schema, and exceptional post-provider validation
failures are held as a server-owned pending logical turn. Ordinary
engine-authoritative action rejection remains a completed `rejected` outcome.
Manual Retry reuses the same agent
observation and world boundary while resolving the model and reasoning profile
again from current operator configuration. Operator Skip commits an explicit
`operator-skipped` record without invoking a world action, communication, or
diplomacy, then advances the cursor once. Neither path schedules an automatic
retry.

For a new logical turn, the service owns one 75-second deadline and permits at
most two provider calls: initial plus either one contract repair or one transient
transport retry. Both calls receive the same immutable observation, resolved
model, and reasoning profile. Repair prompts are fresh universal flat-JSON
requests containing only allowlisted validation codes; raw invalid output is
discarded. Structurally normalized decisions enter the normal engine path once,
and engine rejection is never an automatic retry condition. Manual Retry makes
exactly one request per click, may include the latest safe feedback, and cannot
trigger nested recovery.

The development world is a deterministic H3 resolution-nine radius-six disk (127 cells) around Toledo with eight fixed profiles and unique perimeter starts. One agent acts per turn in stable array order, so 200 completed turns give every agent exactly 25 turns. Each provider call asks for one flat JSON object containing a required world action, zero or one communication, and zero or one diplomacy intent (`propose-alliance`, `accept-alliance`, or `leave-alliance`). Required sentinel-bearing fields normalize into the internal unions before existing Zod and engine validation. There are no social ticks, background inference calls, or automatic replies.

Names, colors, stable IDs, and starting cells remain fixed. Personality text is mutable session configuration, but each observation copies the active value at turn start. Completed observations and turn records remain immutable, so a newly edited active personality can intentionally differ from the latest historical observation until that agent acts again.

The engine alone accepts or rejects all components and creates events. The service preserves the pre-decision state, then applies world action, communication, diplomacy, and automatic proposal expiry in that deterministic order. Direct-message eligibility uses the preserved pre-action state. Each rejected component leaves the others intact. Missing text, unusable JSON, contradictory fields, timeouts, and truncated output follow the provider-failure path, stop all playback, and preserve the world without expiring proposals. Operator cancellation is separate: it aborts the active request, applies no world or proposal changes, creates no turn record, does not advance the cursor or completed-turn count, and returns to paused state. The active request and browser request settle before between-turn model editing is re-enabled.

## Formal alliance state

World state owns up to four active alliances and bounded pending proposals. Alliance and proposal IDs are system-generated typed UUIDs. Each alliance contains two to eight unique agents, each agent belongs to at most one alliance, and the engine allocates the first free color from a fixed four-color accessible palette. A proposal records proposer, recipient, proposer alliance at creation, originating turn, and expiration turn. Created at turn `N`, it remains eligible through turn `N + 8` and expires after that turn without inference.

Free agents may propose only to free agents; allied agents may invite a free agent into their current alliance. Recipient-only acceptance either forms a two-agent alliance or recruits into the recorded unchanged alliance. Membership changes invalidate impossible proposals. Departure is unilateral; individual hex control never changes, and an alliance dissolves below two members. Hexes store only individual `controllerAgentId`; effective marker and territory color is derived from the controller's current alliance, or its permanent base color when unaffiliated. Capture eligibility rejects `allied-controller`.

Public communication is visible to every agent without a range check. Direct communication authoritatively trims and bounds text, requires a distinct existing recipient, and accepts inclusive pre-action H3 distances 0–3. Moving closer in the same decision cannot change eligibility. Accepted communications enter the bounded world-event stream; rejected attempts remain safe structured turn telemetry with a reason, sender, channel, recipient when applicable, nullable computed distance, timestamp, event ID, and trimmed text. No raw provider response is retained.

Snapshots keep the newest 120 turn records and 120 world events. Observations expose controller/alliance/effective-color data for current and adjacent cells, up to seven other agents, an eight-entry individual scoreboard, active alliance totals and member contributions, relevant proposals, at most eight chronological alliance events, six control changes, 12 public messages, and six relevant direct messages. These are bounded event-derived views, and all model-authored text remains untrusted subordinate context.

## Experiment telemetry and export

The active experiment has a runtime-validated UUID, start time, versioned authoritative scenario and ordered initial roster, immutable configuration events, initial world, and up to 5,000 complete safe turns. The browser snapshot and world-event list remain capped at 120. Reset creates a new experiment from the current scenario and clears telemetry/cost; no previous experiments survive reset or process restart.

Metrics and filtering are deterministic Game API responsibilities. Schema version 7 adds attempt-aware Retry/Skip accounting to the model and reasoning-profile assignments introduced in schema version 6. A turn's top-level provider metadata records the final attempt, while `modelAttempts` is canonical for call, token, and cost totals. Imports preserve recorded slugs and profiles; schema-v6 documents remain supported and missing profiles migrate to Provider default, while legacy schema-v5 documents have no assignment and remain blocked until the operator selects one.

The agent runtime follows [OpenRouter's usage-accounting contract](https://openrouter.ai/docs/cookbook/administration/usage-accounting) and normalizes optional non-streaming usage fields: prompt, completion, total, reasoning, cached-read, cache-write tokens, and actual `usage.cost` as `costCredits`. It never derives price from a table. Safe usage already returned with a billable response is retained on later decision JSON/schema failure; network and HTTP failures without usage remain unknown. Scripted providers explicitly report zero tokens and zero cost.

## Packages

`packages/shared` owns centralized scenario limits and all public schemas, including model capabilities, behavior assignments, alliances, metrics, and schema-v9 exports. Other-agent observations remain deterministically capped at seven for larger rosters. Types are inferred from Zod.

`packages/world-engine` remains deterministic and has no model, HTTP, UI, storage, or credential dependency. It validates world action, communication, and diplomacy independently and is the sole alliance mutation authority. Direct proximity is derived from a separately supplied pre-action state.

`packages/agent-runtime` contains the OpenRouter adapter and server-only catalog client. The universal contract requires text input/output, chat completions, `max_tokens`, non-streaming operation, and at least 16,384 context tokens. The centralized floor covers the bounded complete observation and fixed prompt while reserving a 4,096-token completion ceiling for the JSON decision. Catalog requests use matching server filters, then locally validate every entry. Inference requests deliberately omit tools, `tool_choice`, `response_format`, and `provider.require_parameters`. Provider-default reasoning omits `reasoning`; Off sends `{ enabled: false, exclude: true }`; an advertised effort sends `{ enabled: true, effort, exclude: true }`. No model-family logic, allowlist, compatibility flag, or model default exists.

The catalog has an eight-second timeout and five-minute in-memory TTL. A successful response replaces the cache. A timeout, transport/HTTP failure, or malformed response retains the last successful catalog and marks it stale with a safe error; without a prior success it returns an empty error state. Manual refresh bypasses TTL while coalescing concurrent refreshes.

Every agent resolves an explicit global assignment or per-agent override before execution, including its reasoning profile. The acting agent's resolved slug and profile are passed to its request. Assignments may change while playback is paused and no provider/reset mutation is active. Each change is exported with timestamp, scope, prior/new slug, prior/new reasoning profile, and effective next-turn boundary. No unavailable model/profile or missing model is substituted.

The centralized 75-second provider abort timeout covers the complete response lifecycle, including body reading, response decoding, bounded JSON extraction/repair, normalization, and schema validation, and is cleared after every outcome. The same AbortController supports an explicit non-turn-consuming operator cancellation. Safe records expose only bounded status/code/message/request ID/model/finish-reason/latency/usage fields. Scripted providers are explicit deterministic seams selected only by tests or `AGENTBORNE_PROVIDER=scripted`; there is no automatic fallback. Manual probes use the exact text/flat-JSON contract and selected reasoning profile, never mutate or advance the world, may incur a small charge, and are cached only for the current server session by model ID, reasoning profile, and contract version.

The deadline is shared by both permitted automatic attempts rather than renewed
per call. Turn and Retry browser mutations carry bounded client operation IDs,
and repeated delivery is coalesced server-side. When a proxy connection resets
or a response is otherwise lost, the World Lab clears its local guard, refetches
the authoritative snapshot, and shows a height-stable reconciling state while
polling an active request. It never resubmits merely because a response was
ambiguous.

Attempt aggregation is field-wise: known prompt, completion, total, reasoning,
cache-read, and cache-write values remain visible even when another attempt has
no usage metadata. Completeness and unknown-token-attempt counts prevent partial
totals from appearing complete. Known cost remains an exact sum; unknown cost is
reported separately by provider attempt and by distinct logical turn. Missing or
unusable 429 `Retry-After` metadata uses a centralized 1.5-second fallback only
when it fits the original deadline, and the active cancellation signal aborts
the wait.

The rationale and deferrals are recorded in [ADR 0002](adr/0002-first-visible-llm-invasion.md).
Personality ownership and reset semantics are recorded in [ADR 0003](adr/0003-session-personality-configuration.md).
Experiment capture and export semantics are recorded in [ADR 0004](adr/0004-server-owned-experiment-telemetry.md).
Nearby-message authority, observation bounds, and export selection semantics are recorded in [ADR 0005](adr/0005-nearby-agent-messaging.md).
Contested control, capture, territory authority, and schema-v3 selection semantics are recorded in [ADR 0006](adr/0006-contested-hex-control.md).
Decoupled communication and schema-v4 selection semantics are recorded in [ADR 0007](adr/0007-decoupled-world-communication.md).
Formal alliances, the expanded experiment, and schema-v5 semantics are recorded in [ADR 0008](adr/0008-formal-alliances-experiment.md).
Capability-driven model discovery and experiment assignments are recorded in [ADR 0009](adr/0009-capability-driven-model-catalog.md).
Versioned behavior profiles, seeded assignment, and authoritative diplomacy affordances are recorded in [ADR 0010](adr/0010-versioned-agent-behavior.md).

Behavior configuration is experiment-owned and includes registry version 1, assignment mode, seed, and one allowlisted personality/strategy pair per agent. Balanced random is the safe default. Reset creates a new experiment and deterministic assignment from its seed; the first completed turn locks behavior. Every retained turn copies its effective assignment, while model and reasoning changes retain their existing between-request semantics.

Schema-v8 computed metrics include complete personality, strategy, observed personality/strategy-combination, and agent breakdowns derived from the same filtered retained turns and attempt records as the aggregate. Logical-turn, provider-call, failure, recovery, token, and cost counters therefore remain attributable without storing reasoning. Structural provider failures retain the broad compatibility code plus bounded details such as missing proposal IDs and contradictory diplomacy recipient fields in attempt telemetry and safe exports. Well-formed unavailable IDs remain engine-authoritative rejections and are not retried.
