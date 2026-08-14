# Agentborne

Agentborne is the working title for an agent-first GPS containment game. Persistent, named LLM agents will move across a real-world H3 grid, infect cells, communicate, form relationships, make plans, and react to players. The first product surface is the **World Lab**, a durable developer/admin interface for observing and experimenting with those agents.

This repository is intentionally at the project-foundation milestone. It contains no real model calls or player systems yet.

## Workspace

| Path                     | Responsibility                                          |
| ------------------------ | ------------------------------------------------------- |
| `apps/world-lab`         | Next.js map and future simulation-observation interface |
| `apps/game-api`          | Small Hono HTTP boundary for future clients             |
| `packages/world-engine`  | Pure world validation and consequence application       |
| `packages/agent-runtime` | Model-provider boundary and scripted testing seam       |
| `packages/shared`        | Runtime-validated schemas and shared domain types       |

## Requirements

- Node.js 24.18.0 (see `.nvmrc` and `.node-version`)
- pnpm 11.21.0, pinned by the root `packageManager` field

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The World Lab opens at <http://localhost:3000>. Run `pnpm dev:api` in another terminal for the API at <http://localhost:8787>; its current endpoints are `GET /health` and `GET /api/development-world`.

Copy `.env.example` to `.env.local` only when changing the documented development-map center or H3 resolution. No secret is required.

## Development map source

The default map centers on Toledo, Ohio (`41.6528, -83.5379`) at H3 resolution 9. The shell uses MapLibre GL JS with the public OpenStreetMap raster tile endpoint and visible attribution. That tile endpoint is appropriate for light local development only; it has availability and usage-policy limits and is **not** the production basemap plan. A production deployment must select and configure a compliant tile provider or self-hosted tiles before public traffic.

See [Testing](docs/TESTING.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), and the [Roadmap](ROADMAP.md).
