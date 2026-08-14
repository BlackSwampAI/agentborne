# ADR 0006: Deterministic contested hex control

- Status: Accepted
- Date: 2026-08-14

## Context

Agents need a minimal durable reason to compete, negotiate, cooperate, deceive, and betray without introducing a strategy-game combat or alliance subsystem. Control must remain deterministic, visible, runtime-validated, and compatible with the existing provider-cost safeguard and safe experiment record.

## Decision

Every hex has one explicit validated control shape. An open hex has `controllerAgentId: null`. An infected hex has exactly one `controllerAgentId` naming a valid world agent. Infection claims an open current hex for the acting agent. Reset reconstructs 61 open uncontrolled hexes while preserving the existing active-personality semantics.

`capture` is a first-class exclusive action beside move, infect, message, and wait. It has no target-cell input. The world engine accepts it only when the acting agent's current hex is infected, controlled by another agent, and that controller is not physically present, then deterministically transfers control. Presence comes from authoritative current agent positions. An unrelated occupant does not defend the cell. Capture does not move an agent, change the infected-cell count, communicate, or perform another action. Open-cell, self-controlled, and controller-present attempts receive typed rejection reasons and no mutation.

Observations include one small server-authoritative capture-eligibility value. It explicitly reports eligibility or one bounded blocked reason: open current hex, self-controlled current hex, or current controller present. The fixed provider instruction says that controller presence defends a cell and capture may be requested only when the observation reports eligibility. Applicable safe schema-v3 export observations retain the same value.

Successful captures append bounded typed events containing identity, time, cell, new controller, and previous controller. Observations expose controller data for current and adjacent hexes, an authoritative six-agent controlled-cell scoreboard, and at most six chronological capture events involving the observer with explicit gained/lost direction and the other agent. This history is derived from authoritative bounded events rather than relationship or generic memory state. Messages remain separately bounded untrusted subordinate context.

The Game API counts requested/successful captures, infection gains, capture gains, and capture losses. Current controlled-cell totals are authoritative instantaneous state and remain separate from historical filtered-turn metrics. Capture loss is attributed to the displaced agent even though the action belongs to the capturer's turn.

Generated experiment documents advance to schema version 3. A retained turn still belongs only to its actor, but a successful capture is relevant to both controller participants. The canonical `controlChanges` stream and matching-control-change count make victim-only selections explicit even when they contain zero matching actor turns. Outcome, capture-action, range/latest, and retention filters apply through the originating turn. Captures involving two unselected agents and all rejected captures are excluded. Initial/current world snapshots remain state-only and include controller-bearing hexes. Existing recipient-aware communication filtering remains unchanged.

World Lab colors infected hexes with the controlling agent's existing color at readable opacity while maintaining distinct selected outlines. Text labels identify controllers, territory totals, capture events, and gains/losses so color is never the sole signal.

The first genuine-provider experiment showed capture dominating other choices and one same-cell Ember/Mingle control loop changing hands nine times. Requiring the controller to leave before capture removes that immediately useful ping-pong action while preserving abandoned-territory betrayal. Mingle alone receives a revised social coalition-builder default that explicitly values initiating and continuing conversations and negotiating before capture. The other five defaults remain unchanged, messaging remains model-chosen and exclusive, and agreements remain unenforced.

Automatic playback still pauses and Start remains disabled once all 61 cells are infected. Reset and export remain available, and deliberate Single turn can still produce a charged diagnostic capture. Autonomous post-infection conflict playback is not enabled.

## Consequences

Agents have one deterministic scarce spatial claim worth discussing and contesting, while the engine stays small and auditable. A present controller can hold the cell without combat mechanics, creating room for communication or movement; once it leaves, deterministic capture and betrayal remain possible. Controller state, eligibility, observations, telemetry, UI, and exports share one runtime-validated vocabulary. Victim-aware selection is more complex than actor-only turn filtering, so canonical control events and current territory are explicit separate streams.

Formal teams, factions, alliances, treaties, trust/reputation scores, health, damage, attack or defense odds, resources, production, fortifications, territory bonuses, cooldowns, respawning, elimination, fog of war, and post-infection autonomous conflict playback remain deferred.
