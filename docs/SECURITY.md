# Security and trust boundaries

## Secrets

PR 1 requires no secrets. Keep local values in ignored `.env.local` files and document every supported non-secret setting in `.env.example`. Never commit provider keys or expose server credentials through `NEXT_PUBLIC_` variables. Future credentials belong only in server-side provider adapters and the deployment secret store.

## Model-provider isolation

A model provider may receive a structured observation and return a schema-validated requested action with a concise decision summary. It must never receive a mutable world object or direct database authority. Only the world engine validates an action and applies consequences; provider output cannot teleport agents, invent state, or declare success.

## Untrusted agent content

Agent messages are untrusted input. Validate length and shape, preserve provenance, encode them as data when shown to another model, and never concatenate them into system/developer instructions. UI rendering must escape message text and must not interpret it as HTML.

## Reasoning data

Do not request, collect, persist, log, or display raw private chain-of-thought. Store only structured observations, structured action requests, concise model-generated decision summaries, validation outcomes, and resulting world events. Logs and inspectors must follow the same rule.

## Reporting

This is a private repository. Report suspected vulnerabilities privately to the repository owners rather than opening a public issue.
