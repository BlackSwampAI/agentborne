# Roadmap

Player development begins only after the agent milestones below demonstrate compelling behavior. Each milestone is intended to remain a focused pull request; do not implement ahead of the current milestone.

## PR 1 — Project foundation and CI

Create the permanent project structure, World Lab shell, initial H3 map, minimal world-domain boundaries, documentation, tests, and GitHub Actions.

## PR 2 — First visible LLM invasion

Produce the first video-worthy result:

- Approximately 5–10 genuine model-backed agents
- Visible markers on the real map
- Movement between adjacent hexes
- Infection of current hexes
- Start, pause, reset, single-turn, and playback-speed controls
- Clickable agents
- Agent inspector showing personality, observations, requested action, concise decision summary, validation result, and recent events
- No player systems

By the end of PR 2, a human must be able to watch real agents independently move around and infect the map.

Implementation scope: six fixed agent profiles, a 61-cell Toledo development world, server-owned in-memory round-robin turns, OpenRouter strict structured decisions, live World Lab controls/markers/inspector, and deterministic offline automation. Persistence, autonomous scheduling, messaging, and player systems remain explicitly out of scope.

## PR 3 — Personality Lab

Prompt/personality editing, presets, cloning, respawning, reproducible starting worlds, provider/model configuration, and cost visibility.

First focused slice: server-owned session personality editing for the six existing agents, five bounded presets, world reset that preserves active personality configuration, and a separate confirmed restore-default action. Persistence across process restarts, cloning, respawning, provider/model configuration, cost visibility, and social mechanics remain deferred to later focused slices or milestones.

Second focused slice: server-owned safe experiment telemetry, actual OpenRouter usage/cost visibility, filtered tiered JSON export, and automatic browser playback pause when all 61 development cells are infected. The active experiment retains 5,000 complete safe records independently of the 120-turn browser snapshot; reset creates a new experiment and process restart still loses all telemetry. Persistence, multiple stored experiments, upload/sharing, provider configuration, and budget enforcement remain deferred.

## PR 4 — Social agents

Range-limited messages, agent inboxes, relationship memories, communication visualization, cooperation, refusal, deception, and betrayal emerging through prompts rather than a large formal rules system.

First focused slice: messaging is one exclusive turn action to a single existing agent within inclusive H3 distance three. Accepted messages become bounded world events and supply at most six recent inbound/outbound communications to later observations. World Lab and safe experiment exports expose this event-derived context. Generic inboxes, persistent or semantic memory, relationships, group chat, automatic replies, and communication visualization remain deferred.

Second focused slice: every infected hex has one individual controller. Infect claims an open current hex and capture deterministically transfers an infected current hex from another agent only after that controller leaves it; controller presence defends against immediate capture and control ping-pong. Observations expose explicit capture eligibility, an authoritative six-agent territory scoreboard, and at most six event-derived relevant gains/losses. Mingle alone receives a social coalition-builder default so messaging remains deliberately exercised without becoming automatic. Telemetry and schema-v3 exports are victim-aware. Combat calculations, formal alliances, resources, territory bonuses, and post-infection autonomous conflict playback remain deferred.

## PR 5 — Goals and memory

Persistent short- and long-term objectives, compact memories, plan revision, summaries, and longer simulation runs.

## PR 6 — Persistent autonomous world

Scheduled turns, snapshots, replay, retries, idempotency, budgets, failure recovery, and operation without the World Lab browser being open.

Player development begins only after these agent milestones demonstrate compelling behavior.
