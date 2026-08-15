# ADR 0002: First visible LLM invasion

- Status: Accepted
- Date: 2026-08-13

## Context

Roadmap PR 2 needs a browser-observable, genuine model-backed simulation without prematurely adding persistence or autonomous infrastructure. Model output is untrusted and must not own world consequences.

## Decision

The Game API owns one in-memory development simulation. It reconstructs a deterministic 61-cell Toledo H3 world with six fixed profiles and starting cells on reset or process startup.

Turns advance one agent at a time in deterministic round-robin order. The application service builds a fresh immutable observation and calls the provider once. OpenRouter is behind `packages/agent-runtime` and returns a strict structured requested action plus a concise visible summary. Only `packages/world-engine` validates and mutates authoritative state.

Normal interactive development selects OpenRouter and reports missing configuration or provider failure explicitly. A scripted provider exists only as an explicitly selected deterministic test seam. It is not a fallback and is visibly labeled in the World Lab.

The original milestone used a strict root-object response schema. ADR 0009 supersedes that wire detail with a capability-driven OpenRouter catalog and a universal text response containing one flat JSON decision. Runtime schemas and the world engine remain authoritative for every detailed validation and consequence; no model family receives special handling.

Turn records contain bounded observations, actions, summaries, validation results, events, and safe provider metadata. They never contain raw prompts, raw payloads, secrets, or private chain-of-thought. The total completed-turn count is monotonic and separate from the newest 120 retained turn records. The authoritative world likewise retains only its newest 120 events, while observations receive the newest eight relevant events in chronological order.

Accepted and rejected turn records are fully schema-validated before the service atomically commits the candidate world, record, count, and cursor. Errors originating in the provider decision call become sanitized provider-failure records without world mutation and stop playback. Other engine, schema, or internal errors propagate without changing simulation progress, and turn cleanup restores coherent server/browser in-flight state. The bounded OpenRouter timeout and operator cancellation remain active through body reading, decoding, extraction, and runtime validation. Only bounded sanitized diagnostics enter operator-visible records.

## Consequences

The vertical slice is easy to run and inspect, and individual actions remain video-observable. Process restart loses state. There is no autonomous scheduler, database, queue, authentication, public-deployment protection, long-term memory, or replay durability yet. Those concerns remain later-roadmap work.
