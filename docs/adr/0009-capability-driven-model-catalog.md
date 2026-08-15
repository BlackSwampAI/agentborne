# ADR 0009: Capability-driven model catalog and experiment assignments

## Status

Accepted

## Decision

Agentborne discovers models through OpenRouter's server-side models API and accepts a model only when local validation confirms text input, text output, chat completions, advertised `max_tokens`, `response_format`, and `structured_outputs`, and at least 16,384 context tokens. Requests are non-streaming, use a strict JSON Schema response format and `provider.require_parameters: true`, and contain no reasoning configuration.

The context floor is centralized in `packages/shared`. Agent observations and all model-authored fields are already bounded; 16,384 tokens leaves substantial headroom beyond the complete fixed prompt and bounded observation plus the 1,024-token response budget.

The Game API owns the credential, sanitized catalog, five-minute process-local cache, and model assignments. One global selection resolves for every agent unless an explicit per-agent override exists. Assignments lock after the first completed turn and are exported in schema version 6. Imports preserve unavailable slugs and legacy schema-version-5 documents require explicit selection. Neither the catalog nor runtime substitutes models.

## Consequences

Compatibility is determined only by declared capabilities and context, never model family, provider family, allowlist, or bespoke flag. Local Zod parsing remains authoritative for model output and the world engine remains authoritative for simulation rules. Catalog failure can use the last successful cache with a visible stale state, but cannot make an unassigned or unavailable experiment runnable.

The process-local cache and assignments disappear with the development server; persistent experiment storage, authentication, budget enforcement, popularity/throughput ranking, and catalog history are deferred.
