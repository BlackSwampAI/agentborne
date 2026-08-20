# ADR 0014: Simultaneous tick authority

- Status: accepted
- Date: 2026-08-20

## Context

Sequential model turns leak earlier decisions into later observations, give
permanent roster-order advantage, and make multi-agent experiments difficult to
compare. Provider latency and failure must not determine game authority.

## Decision

The Game API owns one explicit tick transaction. It freezes a world snapshot and
constructs every agent observation before dispatch. The agent runtime provides a
provider-neutral bounded-concurrency dispatcher. Every job has an immutable
observation, resolved agent/model/reasoning identity, the same absolute deadline,
and at most one existing automatic repair or transient retry inside that
deadline.

The simulation derives a seed-and-tick resolution order, independent of provider
completion order. The deterministic world engine resolves all world actions,
then communications using frozen pre-tick eligibility, then diplomacy, then one
proposal-expiration pass. Proposal lifetimes are expressed in ticks for new
records while legacy turn fields remain readable for schema-v9 compatibility.

One failed, malformed, or unfinished decision becomes an attributed final lost
tick; valid sibling decisions continue. There is no pending failed-turn,
manual Retry/Skip, or unattended recovery path for ticks. Cancellation aborts
all jobs and atomically discards the candidate state and records.

Each committed tick advances a deterministic server-owned virtual clock by an
inclusive scenario-owned interval (default 5–10 minutes) and records the chosen
interval. World Lab may issue ticks quickly but there is no background scheduler
or exact future timing contract for Player Mode.

Safe exports advance to schema v10 with globally unique record ordinals plus
tick number, resolution position, virtual time, interval, and lost-tick outcome.
Browser and experiment retention evict complete oldest tick groups only. The
export also derives per-tick latency, provider-call, deadline, and known/unknown
cost summaries from all model attempts. The SQLite archive migrates tick columns
while retaining schema-v9 import support. Proposal-expiry events are attached to
the final resolution record while their `turnNumber` remains that global record
ordinal.

## Consequences

One operator tick can incur a provider request for every active agent. Provider
completion timing cannot change resolution. Deterministic conflicts may reject
later intents without invalidating accepted sibling components. Atomic
cancellation may discard already completed provider work and its cost.

## Deferred

Simulated or real players, threat observations, GPS, player capture/disinfection,
background scheduling, restart persistence, provider batch APIs, local endpoint
routing, goals, memory, new world actions, resources, and combat remain deferred.
