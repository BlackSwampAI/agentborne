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

## PR 4 — Social agents

Range-limited messages, agent inboxes, relationship memories, communication visualization, cooperation, refusal, deception, and betrayal emerging through prompts rather than a large formal rules system.

## PR 5 — Goals and memory

Persistent short- and long-term objectives, compact memories, plan revision, summaries, and longer simulation runs.

## PR 6 — Persistent autonomous world

Scheduled turns, snapshots, replay, retries, idempotency, budgets, failure recovery, and operation without the World Lab browser being open.

Player development begins only after these agent milestones demonstrate compelling behavior.
