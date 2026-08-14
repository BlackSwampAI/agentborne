# Security and trust boundaries

## Secrets and deployment

`OPENROUTER_API_KEY` is read only by the Game API process. It must never use a `NEXT_PUBLIC_` name, enter a shared schema, reach an API response, or appear in logs. `.env.local` is ignored; `.env.example` contains only a placeholder. Provider errors are reduced to bounded codes and generic messages before recording.

The development API has no authentication, rate limiting, or spending guard. It binds to loopback and its CORS allowlist is limited to the documented local World Lab origins. Do not deploy its cost-incurring turn endpoint to unauthenticated public traffic.

## Model-provider isolation

OpenRouter receives one immutable structured observation. It never receives a mutable world object, storage handle, browser credential, or authority to claim success. The returned JSON is parsed and runtime-validated before the deterministic world engine validates and applies the action.

The request uses strict JSON Schema structured output and provider routing with `require_parameters: true`. Timeouts, network failures, HTTP failures, malformed JSON, and schema failures produce sanitized provider-failure records. The adapter never silently substitutes scripted behavior.

## Prompt and reasoning data

The model is explicitly instructed to return only one structured action and one concise visible summary, with no hidden reasoning or chain-of-thought. The application stores no raw prompts, raw provider payloads, or private reasoning. Inspector and event-log content is rendered as React text.

Agent-authored content remains untrusted. Messaging is not exposed to PR 2 providers or UI and remains deferred.

## Reporting

This is a private repository. Report suspected vulnerabilities privately to the repository owners rather than opening a public issue.
