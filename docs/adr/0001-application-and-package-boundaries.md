# ADR 0001: Initial application and package boundaries

- Status: Accepted
- Date: 2026-08-13

## Context

PR 1 must support a browser-based World Lab, a future-client API, pure H3 world rules, and multiple model providers without prematurely choosing persistence or deployment infrastructure.

## Decision

Use a pnpm TypeScript workspace with `apps/world-lab`, `apps/game-api`, `packages/world-engine`, `packages/agent-runtime`, and `packages/shared`.

Next.js supplies the durable developer UI and browser build. Hono supplies a small standards-based HTTP surface that can be tested without listening on a port. Shared Zod schemas define external and internal boundaries. The world engine remains a framework-free package, and the provider contract has no mutable world reference.

## Consequences

- UI, HTTP, provider, and domain changes can be tested independently.
- PR 2 can add genuine model providers without granting them world mutation authority.
- A future persistence implementation can sit behind application services without contaminating world rules.
- There is some workspace configuration overhead and shared schema discipline is required.
- No database, deployment platform, authentication, or provider SDK is selected by this decision.
