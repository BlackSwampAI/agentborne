# Security and trust boundaries

## Secrets and deployment

`OPENROUTER_API_KEY` is read only by the Game API process. It must never use a `NEXT_PUBLIC_` name, enter a shared schema, reach an API response, or appear in logs. The repository-root `.env` is ignored; `.env.example` contains only a placeholder. Provider errors are reduced to bounded codes and generic messages before recording.

The development API has no authentication, rate limiting, or spending guard. It binds to loopback and its CORS allowlist is limited to the documented local World Lab origins. Do not deploy its cost-incurring turn endpoint to unauthenticated public traffic.

## Model-provider isolation

OpenRouter receives one immutable structured observation. It never receives a mutable world object, storage handle, browser credential, or authority to claim success. The returned JSON is parsed and runtime-validated before the deterministic world engine validates and applies the action.

The request uses strict JSON Schema structured output and provider routing with `require_parameters: true`. Its Gemini-compatible action union uses nested `anyOf` object variants with single-value enums. Timeouts, network failures, HTTP failures, malformed JSON, and schema failures produce sanitized provider-failure records. The adapter never silently substitutes scripted behavior.

Non-success OpenRouter bodies are read only up to a fixed bound. The adapter extracts a sanitized status, provider code/message, request ID, and selected model for local CLI diagnosis, redacts credentials and observation strings, and discards the raw body. These diagnostics remain in-process and are excluded from turn records, snapshots, browser responses, and normal logs.

## Prompt and reasoning data

The model is explicitly instructed to return only one structured action and one concise visible summary, with no hidden reasoning or chain-of-thought. The request selects low reasoning effort and sets `exclude: true`, so reasoning is not returned. The application stores no raw prompts, raw provider payloads, or private reasoning. Inspector and event-log content is rendered as React text.

Agent-authored content remains untrusted. Messaging is not exposed to PR 2 providers or UI and remains deferred.

World Lab personality edits are also untrusted, bounded text. The Game API trims and runtime-validates them before changing the authoritative session, and rejects changes during an active turn. The runtime supplies the active personality only inside the immutable observation as subordinate behavioral context. It is never interpolated into the fixed system instruction and cannot grant actions, weaken engine validation, request secrets, or authorize prompt/reasoning disclosure. React renders active and historical personality text as text rather than HTML.

Personality mutation errors use typed, generic response bodies. They do not expose raw prompts, provider responses, credentials, diagnostics, stack traces, or internal service details. There is still no authentication or persistence; these endpoints remain limited to the loopback development surface.

## Reporting

This is a private repository. Report suspected vulnerabilities privately to the repository owners rather than opening a public issue.
