# ADR 0004: Server-owned safe experiment telemetry and tiered export

- Status: Accepted
- Date: 2026-08-14

## Context

Personality Lab experiments need enough safe behavioral and billing context for external analysis without changing model prompts, depending on the browser's bounded snapshot, or introducing persistence. Operators also need to distinguish actual known provider cost from unavailable accounting.

## Decision

The Game API owns one process-local experiment. Startup and World Reset generate a runtime-validated experiment UUID and capture the start time, initial six-agent configuration, initial world, immutable personality configuration events, and completed safe turns. It retains at most 5,000 complete experiment turns independently of the existing newest-120 browser snapshot. Absolute bounds, dropped count, and completeness disclose truncation. Reset preserves active personalities but discards the prior experiment and cost totals; restart loses all state.

The agent runtime normalizes optional OpenRouter non-streaming usage fields and actual `usage.cost` as `costCredits`. No pricing table is used. Known metadata survives decision parsing/schema failures after a billable response; unavailable usage remains unknown. Explicit scripted providers report deterministic zero usage and cost.

The Game API validates agent, turn, outcome, action, level, serialization, and Custom inclusion filters, computes metrics over the selected retained subset, and constructs schema-versioned Minimal, Standard, Full safe, or Custom documents. Provider costs use exact decimal-string accumulation before returning the JSON number, avoiding binary summation artifacts without discarding tiny charges. Full-safe world snapshots keep all agents and hex states as spatial context but omit event history; filtered top-level `worldEvents` is canonical. Compact JSON is the AI-sharing default; Pretty JSON is optional for human review. Preview serializes the prospective document using the selected encoding for an exact UTF-8 byte count and uses `ceil(bytes / 4)` as a clearly approximate model-agnostic AI-input-token estimate. Browser copy and download consume the same validated generated document and encoding.

Captured and exported data excludes credentials, authorization headers, fixed prompts, raw provider payloads, private reasoning, and unbounded diagnostics. Export is rejected during concurrent simulation mutation. The world engine remains unaware of telemetry and billing.

World Lab stops automatic playback and disables Start when all 61 cells are infected. This is a browser cost safeguard, not a world-engine win condition; Reset, export, and deliberate Single turn remain available.

## Consequences

Operators can inspect cost and safely share compact or rich experiment records without altering inference usage. Long experiments disclose loss beyond 5,000 retained records, and there is no recovery after reset or process restart. There is no database, historical experiment list, cloud sharing, automatic AI submission, hard budget, or account-balance integration.
