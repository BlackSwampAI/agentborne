# ADR 0002: First visible LLM invasion

- Status: Accepted
- Date: 2026-08-13

## Context

Roadmap PR 2 needs a browser-observable, genuine model-backed simulation without prematurely adding persistence or autonomous infrastructure. Model output is untrusted and must not own world consequences.

## Decision

The Game API owns one in-memory development simulation. It reconstructs a deterministic 61-cell Toledo H3 world with six fixed profiles and starting cells on reset or process startup.

Turns advance one agent at a time in deterministic round-robin order. The application service builds a fresh immutable observation and calls the provider once. OpenRouter is behind `packages/agent-runtime` and returns a strict structured requested action plus a concise visible summary. Only `packages/world-engine` validates and mutates authoritative state.

Normal interactive development selects OpenRouter and reports missing configuration or provider failure explicitly. A scripted provider exists only as an explicitly selected deterministic test seam. It is not a fallback and is visibly labeled in the World Lab.

The OpenRouter path targets `google/gemini-3.7-flash` with required parameter support, a bounded `max_tokens` budget, and low-effort reasoning excluded from responses. Its strict root-object response schema expresses the three action variants through a nested `anyOf` with single-value discriminator enums; runtime schemas and the world engine remain authoritative for all detailed validation and consequences.

Turn records contain bounded observations, actions, summaries, validation results, events, and safe provider metadata. They never contain raw prompts, raw payloads, secrets, or private chain-of-thought. The total completed-turn count is monotonic and separate from the newest 120 retained turn records. The authoritative world likewise retains only its newest 120 events, while observations receive the newest eight relevant events in chronological order.

Accepted and rejected turn records are fully schema-validated before the service atomically commits the candidate world, record, count, and cursor. Only errors originating in the provider decision call are converted to sanitized, recorded provider failures. Other engine, schema, or internal errors propagate without changing simulation progress, and turn cleanup restores a coherent idle status. OpenRouter's timeout remains active through body reading, decoding, extraction, and runtime validation, with final cleanup on every outcome. Bounded sanitized HTTP diagnostics are available only to the opt-in smoke CLI and never enter simulation records or browser responses.

## Consequences

The vertical slice is easy to run and inspect, and individual actions remain video-observable. Process restart loses state. There is no autonomous scheduler, database, queue, authentication, public-deployment protection, long-term memory, or replay durability yet. Those concerns remain later-roadmap work.
