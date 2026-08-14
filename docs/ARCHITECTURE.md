# Architecture

Agentborne begins as a TypeScript monorepo with two deployable applications and three domain packages. The split keeps the world rules independent of frameworks while leaving clean seams for the model-backed work in PR 2.

```text
World Lab ─────┐
               ├── shared schemas
Game API ──────┤
               ├── world engine ── H3
Agent runtime ─┘        ▲
                        │ structured action request only
```

## Applications

`apps/world-lab` is a Next.js App Router application. It renders a MapLibre basemap and an H3 GeoJSON overlay. The current development snapshot is created locally so the shell has no service-start dependency. As API-backed state arrives, the UI should consume the same shared response schemas rather than duplicate contracts.

`apps/game-api` is a Hono service on Node. It currently proves the process and HTTP boundary with health, development-world, not-found, and error shapes. It has no persistence, authentication, scheduler, or player routes.

## Packages and flow

`packages/shared` owns branded identifiers, action/event schemas, snapshots, and error envelopes. These are runtime Zod schemas first, with TypeScript types inferred from them.

`packages/world-engine` validates requested actions and returns a new world state plus either a world event or a machine-readable rejection. It owns consequences; callers and model providers do not. The package has no network, UI, model, or database dependency.

`packages/agent-runtime` defines structured observations and decisions. A provider receives an immutable observation and returns a requested action plus a concise summary. The included scripted provider is a deterministic test seam, not a simulation and not a substitute for PR 2's genuine model-backed agents.

## Current state model

The in-memory world contains H3 cells (`open` or `infected`), named agents with a current cell, and append-only world events. Infection persists independently from an agent's position. Messages are validated for recipient and range, but inboxes and relationship memory are intentionally deferred to PR 4.
