# ADR 0009: Capability-driven model catalog and experiment assignments

## Status

Accepted

## Decision

Agentborne discovers models through OpenRouter's server-side models API and accepts a model only when local validation confirms text input, text output, chat completions, advertised `max_tokens`, and at least 16,384 context tokens. Requests are non-streaming plain-text chat completions. The prompt requires exactly one deliberately flat JSON object whose sentinel-bearing fields normalize into the existing local decision unions.

The context floor, 4,096-token completion ceiling, 75-second provider timeout, and decision-contract version are centralized in `packages/shared`. The complete observation is bounded: eight-agent summaries, at most 12 public and six relevant direct messages, bounded event windows, a 600-character personality, and 280-character messages. A 16,384-token context therefore leaves substantial headroom for that fixed prompt and observation while reserving the full completion ceiling for the JSON response.

The Game API owns the credential, sanitized catalog, five-minute process-local cache, explicit runtime-verification cache, and model assignments. One global selection resolves for every agent unless an explicit per-agent override exists. Assignments may change only between provider requests; every change records its scope, previous/new slug, timestamp, and effective turn boundary in safe exports. Imports preserve unavailable slugs and legacy schema-version-5 documents require explicit selection. Neither the catalog nor runtime substitutes models.

Inference requests deliberately omit tools, `tool_choice`, `response_format`, `provider.require_parameters`, and every model-specific parameter. The operator may leave reasoning at Provider default, disable it only when metadata says it is optional, or select only an effort explicitly advertised by that model. Provider default omits `reasoning`; Off sends `{ enabled: false, exclude: true }`; an effort sends `{ enabled: true, effort, exclude: true }`. Numeric reasoning-token usage may still be recorded when OpenRouter reports it, but reasoning text is never retained. No model name participates in request construction.

## Consequences

Compatibility is determined only by text modality, context, and the universal `max_tokens` request parameter, never model family, provider family, tool support, structured-output support, reasoning metadata, allowlist, or bespoke flag. The runtime extracts a single JSON object from text and conservatively repairs code-fence/prose wrapping and trailing commas. Strict local Zod parsing remains authoritative for the normalized model output and the world engine remains authoritative for simulation rules. Catalog failure can use the last successful cache with a visible stale state, but cannot make an unassigned or unavailable experiment runnable.

Catalog compatibility and runtime verification are distinct. A manual “Test selected model” action performs one bounded, potentially billable, non-mutating request with the production text/flat-JSON contract and selected reasoning profile, then caches its result by model ID, profile, and contract version for the server session. It is never run automatically. Global and per-agent assignments persist their profiles; missing values in older schema-v6 exports migrate to Provider default, and configuration events record previous/new profiles. Provider, timeout, missing-text, JSON, normalization, and simulation-rule failures remain distinct. Provider failures stop playback and return the operator to a recoverable between-request state. Operator cancellation instead produces no turn record, does not advance the turn/cursor, and returns the same experiment to paused state. LangChain is intentionally unnecessary for this transport contract.

Schema-v7 telemetry treats `modelAttempts` as the canonical billable-usage source. Logical-turn outcomes and model calls are separate counters: retries add calls, tokens, and cost without adding turns, while an operator skip adds one `operatorSkipped` logical outcome and no provider call. Schema-v6 model-configuration imports remain supported.

The process-local cache and assignments disappear with the development server; persistent experiment storage, authentication, budget enforcement, popularity/throughput ranking, and catalog history are deferred.
