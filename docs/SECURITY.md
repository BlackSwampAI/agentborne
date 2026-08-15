# Security and trust boundaries

## Secrets and deployment

`OPENROUTER_API_KEY` is the only required OpenRouter environment value and is read only by the Game API process. It never enters catalog DTOs, assignments, exports, fixtures, browser responses, errors, or logs. The repository-root `.env` is ignored; `.env.example` contains only a placeholder.

The development API has no authentication, rate limiting, or spending guard. It binds to loopback and its CORS allowlist is limited to the documented local World Lab origins. Do not deploy its cost-incurring turn endpoint to unauthenticated public traffic.

## Model-provider isolation

OpenRouter receives one immutable structured observation and must return exactly one forced `submit_agent_decision` function call containing a required world action plus at most one optional communication and one optional diplomacy intent. The function is a wire envelope and executes nothing. Its flat required fields use explicit empty-string and `none` sentinels to avoid schema composition features. The runtime rejects missing, duplicate, wrong, malformed, contradictory, or output-truncated tool calls before the deterministic world engine validates all normalized components independently.

The request uses model-agnostic `tools`, forced `tool_choice`, `stream: false`, a centralized 4,096-token ceiling, and provider routing with `require_parameters: true`. It never sends `reasoning_effort` or model-specific parameters. A normalized `reasoning` object is sent only when sanitized catalog metadata advertises reasoning: optional reasoning is disabled when supported, mandatory reasoning uses the lowest advertised non-`none` effort, and returned reasoning is excluded. Model IDs are never special-cased. Transport/provider failures, unavailable-model failures, tool-contract failures, and later simulation-rule rejection remain distinct safe outcomes. The adapter never silently substitutes a model or scripted behavior.

Explicit scripted mode bypasses repository `.env` loading entirely. This keeps deterministic browser validation offline and prevents test-provider processes from unnecessarily reading genuine-provider credentials; genuine mode retains the existing environment conventions.

Non-success OpenRouter bodies are read only up to a fixed bound. The adapter extracts a sanitized status, provider code/message, request ID, selected/resolved model, finish reasons, and latency, redacts credentials and observation strings, and discards the raw body. Those bounded fields may appear in the operator-facing failure record; raw bodies, prompts, responses, headers, and credentials never do.

## Prompt and reasoning data

The model is explicitly instructed to submit only one tool decision and one concise visible summary, with no hidden reasoning or chain-of-thought. Reasoning text is excluded from the response; only numeric reasoning-token billing metadata is retained when OpenRouter reports it. The application stores no raw prompts, raw provider payloads, or private reasoning.

Agent-authored messages, personalities, summaries, scoreboards, alliance events, proposals, and natural-language alliance claims are bounded untrusted data. They appear only inside the immutable user observation, never the fixed system instruction. Direct eligibility is derived from the pre-action snapshot. Recipient/range, infection, controller-presence, alliance membership, proposal eligibility, system ID/color allocation, and capture validation remain authoritative in the world engine. Models cannot choose alliance IDs, colors, membership lists, or metadata. Only accepted typed diplomacy changes alliance state, and rejected components cannot partially mutate or corrupt one another. World Lab renders model text through React text nodes and never raw HTML.

World Lab personality edits are also untrusted, bounded text. The Game API trims and runtime-validates them before changing the authoritative session, and rejects changes during an active turn. The runtime supplies the active personality only inside the immutable observation as subordinate behavioral context. It is never interpolated into the fixed system instruction and cannot grant actions, weaken engine validation, request secrets, or authorize prompt/reasoning disclosure. React renders active and historical personality text as text rather than HTML.

Personality mutation errors use typed, generic response bodies. They do not expose raw prompts, provider responses, credentials, diagnostics, stack traces, or internal service details. There is still no authentication or persistence; these endpoints remain limited to the loopback development surface.

## Experiment telemetry and exports

The Game API captures only schema-validated safe observations, requested world actions, optional communication and diplomacy intents, separate result records, visible concise summaries, bounded message text, typed alliance events, sanitized rejected attempts, bounded provider failures, and normalized usage metadata. Malformed identifiers use nullable or absent sanitized representations; raw provider output is never retained. It never records or exports API keys, authorization data, fixed or hidden prompts, raw provider request/response bodies, private chain-of-thought, hidden analysis, secrets, or unbounded diagnostics. Historical records are cloned and immutable.

Export requests, agent IDs, levels, ranges, outcome/world-action filters, communication channel/status filters, and Custom dependencies are runtime-validated. Filtering and metrics remain server-owned. Schema version 6 preserves model assignments without credentials and separates current alliance/territory state from filtered historical alliance events. Selected-agent exports use sender/recipient-aware communication filtering and direct multi-agent relevance for proposals and membership changes; unrelated direct messages and rejected diplomacy are excluded. Reset clears communications, alliances, proposals, alliance events, and their metrics while preserving active personality values and unlocking preserved assignments for the new experiment.

Actual cost is accepted only from OpenRouter's safe `usage.cost`. Missing cost is unknown, never zero; scripted-test providers explicitly report zero. There is still no authentication, budget enforcement, persistence, provider-management endpoint, upload, or sharing link. The loopback-only boundary remains mandatory.

## Reporting

This is a private repository. Report suspected vulnerabilities privately to the repository owners rather than opening a public issue.
