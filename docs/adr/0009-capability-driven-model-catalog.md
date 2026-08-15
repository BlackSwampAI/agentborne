# ADR 0009: Capability-driven model catalog and experiment assignments

## Status

Accepted

## Decision

Agentborne discovers models through OpenRouter's server-side models API and accepts a model only when local validation confirms text input, text output, chat completions, advertised `max_tokens`, `tools`, and `tool_choice`, and at least 16,384 context tokens. Requests are non-streaming, force exactly one `submit_agent_decision` function call, use `provider.require_parameters: true`, and normalize the deliberately flat tool arguments into the existing local decision unions. The tool never executes external behavior.

The context floor, 4,096-token completion ceiling, 75-second provider timeout, and decision-contract version are centralized in `packages/shared`. The complete observation is bounded: eight-agent summaries, at most 12 public and six relevant direct messages, bounded event windows, a 600-character personality, and 280-character messages. A 16,384-token context therefore leaves substantial headroom for that fixed prompt and observation while reserving the full completion ceiling for mandatory reasoning and the final tool call.

The Game API owns the credential, sanitized catalog, five-minute process-local cache, explicit runtime-verification cache, and model assignments. One global selection resolves for every agent unless an explicit per-agent override exists. Assignments may change only between provider requests; every change records its scope, previous/new slug, timestamp, and effective turn boundary in safe exports. Imports preserve unavailable slugs and legacy schema-version-5 documents require explicit selection. Neither the catalog nor runtime substitutes models.

Reasoning behavior is metadata-driven. Non-reasoning models receive no reasoning parameter. Optional reasoning is disabled only through advertised normalized controls. Mandatory reasoning uses the lowest advertised non-`none` effort; when effort is not controllable, unsupported controls are omitted. Returned reasoning text is excluded and never retained. No model name participates in this decision.

## Consequences

Compatibility is determined only by declared capabilities and context, never model family, provider family, allowlist, or bespoke flag. Local Zod parsing remains authoritative for model output and the world engine remains authoritative for simulation rules. Catalog failure can use the last successful cache with a visible stale state, but cannot make an unassigned or unavailable experiment runnable.

Catalog compatibility and runtime verification are distinct. A manual “Test selected model” action performs one bounded, potentially billable, non-mutating request with the production tool contract and caches its result by model ID plus contract version for the server session. It is never run automatically. Provider, timeout, cancellation, tool-call, normalization, and simulation-rule failures remain distinct. Provider failures stop playback and return the operator to a recoverable between-request state. LangChain is intentionally unnecessary for this transport contract.

The process-local cache and assignments disappear with the development server; persistent experiment storage, authentication, budget enforcement, popularity/throughput ranking, and catalog history are deferred.
