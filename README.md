# Agentborne

Agentborne is the working title for an agent-first geographic experiment. A configurable roster of model-backed agents moves, infects, captures contested territory, communicates, and conducts formal alliance diplomacy while the World Lab exposes every safe decision record.

Scenarios may optionally designate one experimental Patient Zero coordinator.
The role receives bounded global strategic information and can send private
advisory directives, but remains subject to the same movement and world-action
rules as every other agent. The universal flat provider contract is
`text-flat-json-v3`; the objective remains `durable-influence-v2`.

## Workspace

| Path                          | Responsibility                                                   |
| ----------------------------- | ---------------------------------------------------------------- |
| `apps/world-lab`              | Next.js developer/admin map, controls, inspector, and event log  |
| `apps/game-api`               | Hono HTTP boundary and in-memory simulation service              |
| `packages/world-engine`       | Pure world validation and consequence application                |
| `packages/agent-runtime`      | OpenRouter provider boundary and explicit scripted testing seams |
| `packages/shared`             | Runtime-validated schemas and inferred domain types              |
| `packages/experiment-archive` | Durable SQLite imports and bounded research queries              |

## Local development

Requirements are Node.js 24.18.0 and pnpm 11.21.0. Copy the example environment file to the repository-root `.env`, replace only the placeholder key, install dependencies, and start both applications:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY.
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the World Lab at <http://localhost:3000>. The Game API binds to <http://127.0.0.1:8787>; Next.js narrowly proxies `/api/game/*` to it. `OPENROUTER_API_KEY` is the only required OpenRouter environment value. Select a compatible global model in World Lab, then optionally override individual agents. Each assignment may use the provider's default reasoning behavior, disable optional reasoning, or select only an effort advertised by that model's catalog metadata.

Each Single turn or completed playback interval makes one third-party OpenRouter request and may incur cost. Start is deliberately disabled when the server has no key. This development API has no authentication or cost controls and is not suitable for an unauthenticated public deployment.

State is held only in the Game API process. The API captures one active safe experiment with up to 5,000 complete turn records while the browser snapshot remains capped at 120. Schema-v8 exports add the behavior registry, seed, assignments, and retained-turn attribution without changing schema-v7 attempt fields. Model and reasoning-profile assignments may be changed between requests; behavior locks after turn one. Schema-v5 through v7 imports remain supported with documented safe defaults. A saved slug absent from the current compatible catalog is preserved and blocks execution until explicitly replaced. Every provider decision is one plain-text response containing a required flat JSON object with one world action, at most one communication, and at most one formal diplomacy intent. The runtime extracts and conservatively repairs JSON before strict local schemas and the world engine apply authoritative validation.

Export previews report exact serialized UTF-8 bytes and a model-agnostic `ceil(bytes / 4)` approximate AI-input-token estimate. Compact JSON is the default for AI sharing; Pretty JSON remains available for human review, and preview estimates reflect the selected serialization. This is a sharing-budget aid, not tokenizer output or a billing guarantee. Exports exclude fixed prompts, raw provider payloads, credentials, authorization headers, private reasoning, and unbounded diagnostics.

## Opt-in real-provider smoke

The smoke command performs exactly one bounded real decision request and validates it. It is never part of default tests or CI:

```bash
pnpm smoke:openrouter -- <compatible-model-slug>
```

The command reads only `OPENROUTER_API_KEY` from the repository-root `.env`; its model slug is an explicit command argument. Values in that file override stale exported values for the smoke process.

## Development map source

The compatible default centers on Toledo, Ohio (`41.6528, -83.5379`) at H3 resolution 9 and renders the same deterministic radius-six disk of exactly 127 cells with eight fixed perimeter starts. World Setup previews and applies resolution 8–11 scenarios with 1–32 agents, radius at most 40, at most 5,000 actual generated cells, and a 12 km default physical communication range. Schema-v9 exports preserve the authoritative scenario and `durable-influence-v2` attribution. MapLibre uses CARTO Dark Matter's tokenless raster tiles with `© OpenStreetMap contributors © CARTO` attribution.

Alliance leadership, merging, custom metadata, combat systems, relationship scores, group chat, persistent memory, player mechanics, restartable world persistence, and autonomous scheduling remain deferred.

When every development cell is infected, World Lab automatically pauses playback and disables Start to avoid accidental provider calls. Reset and export remain available, and Single turn remains an explicitly manual diagnostic action.

World Lab provides browser-owned absolute run targets of **25, 50, 100, 200, 500, and 1,000**. The session-selected target defaults to 200, past/current targets are unavailable, and a bounded run pauses at the authoritative completed-turn target unless cancellation, failure, or full infection stops it first.

The persistent operator shell keeps execution controls, run target, playback speed, current turn, known cost, and run state visible while switching between Live and Agents workspaces. Live centers the map between an independently scrolling agent rail and semantic Scoreboard, Agent, Hex, and Run inspector tabs; a bounded activity dock separates public chat, events, and safe failure/recovery records. Agent configuration uses the same mounted execution controller and existing server-authoritative mutations, so workspace switching cannot duplicate or interrupt playback. Infrequent and destructive operations remain in the accessible overflow menu. Blackberry/teal/mint/celadon/vanilla semantic tokens define the dark application chrome without replacing domain-owned agent and alliance colors.

The agent roster defaults to browser-local **Follow turn** behavior: the inspector follows the active request, or the next scheduled agent while paused. Selecting an agent manually disables following without hiding the roster's textual Acting/Next marker; the preference remains in that browser and is never exported. Public world chat and the event log are newest-first bounded feeds, and the shared Model and Export dialogs keep their headers/actions fixed while their bodies scroll within the viewport.

See [Testing](docs/TESTING.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), the accepted future [Gameplay Foundation](docs/GAMEPLAY_FOUNDATION.md), and the [Roadmap](ROADMAP.md).

Completed schema-v9 exports can be imported into an ignored local SQLite archive and queried without repeatedly loading full JSON artifacts. See [Local experiment archive](docs/EXPERIMENT_ARCHIVE.md).
