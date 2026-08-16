# ADR 0011: Versioned configurable World Lab scenarios

- Status: Accepted
- Date: 2026-08-15

## Decision

The Game API owns runtime-validated `world-scenario-v1` requests, pure previews, and applied scenarios. It generates the actual H3 disk, sums H3 cell areas, enforces 1–32 agents, resolutions 8–11, radius at most 40, and at most 5,000 cells, and records seeds and warnings. Fewer than ten cells per agent is a non-blocking warning.

Spawns use a server-owned seeded shuffle and deterministic greedy separation. Infeasible requests never degrade silently. The exact Toledo default retains its historical roster and starts. Reset reconstructs the current applied topology, identities, starts, models, and behaviors as a new empty experiment.

Location search uses a replaceable server adapter. The Nominatim implementation identifies the application, rate-limits the process, caches bounded normalized results, times out safely, exposes attribution, and is configurable through `NOMINATIM_BASE_URL`. Manual coordinates require no geocoding.

Exports advance to schema v9 and preserve the scenario and `durable-influence-v1` attribution. Versions 5–8 keep their model-assignment-only import meaning. The decision transport remains `text-flat-json-v1`.

## Consequences

The four-alliance palette and eight-member alliance limit remain deliberate. Prompt context does not scale with the roster: other-agent summaries remain sorted and capped at seven, with existing message/event limits. Simultaneous ticks, scheduling, simulated players, player survival language, GPS, capture/disinfection, batches, and local endpoint routing remain deferred.
