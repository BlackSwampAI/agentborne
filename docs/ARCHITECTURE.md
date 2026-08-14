# Architecture

The PR 2 vertical slice preserves a one-way trust boundary:

```text
World Lab → Game API / simulation service → agent runtime → requested action
                                                        ↓
                      snapshot / turn record ← world engine validation
```

## Applications

`apps/world-lab` is a Next.js App Router developer/admin surface. It fetches runtime-validated simulation snapshots through a local rewrite, controls one turn at a time, and updates MapLibre's existing H3 GeoJSON source without recreating the map. Agent markers are fully visible and use deterministic offsets when sharing cells.

`apps/game-api` is a Hono service bound conservatively to loopback. Its single in-memory `SimulationService` owns the development session, monotonic completed-turn count, turn cursor, bounded histories, and overlap lock. It exposes:

- `GET /api/simulation` — current authoritative snapshot
- `POST /api/simulation/turn` — one agent observation, one provider decision, one engine application
- `POST /api/simulation/reset` — deterministic reset, rejected while a turn is active

The legacy `GET /api/development-world` and `GET /health` endpoints remain for low-level diagnostics.

## Turn flow

The development world is an H3 radius-four disk (61 cells) around Toledo with six fixed profiles and starting cells. One agent acts per turn in stable array order. The service reads the latest state, constructs and clones a bounded observation, requests one structured decision, validates it with Zod, and passes only the requested action to the world engine.

The engine alone accepts or rejects actions and creates world events. Rejections do not mutate state and are not replaced by heuristics. The service schema-validates a complete accepted or rejected turn record before atomically committing its candidate world state, turn record, completed-turn count, and round-robin cursor. Unexpected engine, schema, or internal failures propagate as internal API errors and commit none of those changes; cleanup always returns the service to a coherent idle state.

Only failures thrown by the provider decision call become sanitized provider-failure turn records. Those failures remain non-mutating, count as completed recorded turns, advance round robin, and do not prevent later turns. The public turn number is the total completed-turn count and is independent of the retained history: snapshots keep only the newest 120 turn records and newest 120 world events. Observations select the newest eight relevant public events from that retained event history in chronological order.

## Packages

`packages/shared` owns all public schemas: profiles, observations, PR 2 decisions, provider metadata/failures, turn outcomes, snapshots, and API responses. Types are inferred from Zod.

`packages/world-engine` remains deterministic and has no model, HTTP, UI, storage, or credential dependency. Its broader domain action union retains range-limited messaging for the established boundary, but PR 2's model decision schema excludes messaging entirely.

`packages/agent-runtime` contains the OpenRouter adapter. The interactive provider uses strict JSON Schema structured output and requires provider parameter support. Its abort timeout covers the complete response lifecycle, including body reading, JSON decoding, response extraction, and schema validation, and is cleared after every outcome. Scripted providers are explicit deterministic seams selected only by tests or `AGENTBORNE_PROVIDER=scripted`; there is no automatic fallback.

The rationale and deferrals are recorded in [ADR 0002](adr/0002-first-visible-llm-invasion.md).
