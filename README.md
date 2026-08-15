# Agentborne

Agentborne is the working title for an agent-first GPS containment game. Eight persistent, named model-backed agents move, infect, capture contested territory, communicate, and conduct formal alliance diplomacy in one inference in a real Toledo H3 world while the World Lab exposes every safe decision record.

## Workspace

| Path                     | Responsibility                                                   |
| ------------------------ | ---------------------------------------------------------------- |
| `apps/world-lab`         | Next.js developer/admin map, controls, inspector, and event log  |
| `apps/game-api`          | Hono HTTP boundary and in-memory simulation service              |
| `packages/world-engine`  | Pure world validation and consequence application                |
| `packages/agent-runtime` | OpenRouter provider boundary and explicit scripted testing seams |
| `packages/shared`        | Runtime-validated schemas and inferred domain types              |

## Local development

Requirements are Node.js 24.18.0 and pnpm 11.21.0. Copy the example environment file to the repository-root `.env`, replace only the placeholder key, install dependencies, and start both applications:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY.
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the World Lab at <http://localhost:3000>. The Game API binds to <http://127.0.0.1:8787>; Next.js narrowly proxies `/api/game/*` to it. `AGENTBORNE_MODEL` defaults to `google/gemini-3.7-flash`.

Each Single turn or completed playback interval makes one third-party OpenRouter request and may incur cost. Start is deliberately disabled when the server has no key. This development API has no authentication or cost controls and is not suitable for an unauthenticated public deployment.

State is held only in the Game API process. The API captures one active safe experiment with up to 5,000 complete turn records while the browser snapshot remains capped at 120. Every provider decision contains one required world action, at most one communication, and at most one formal diplomacy intent; all three components are independently validated and use one provider call. Formal proposals are public state, expire after eight completed turns, and can create, recruit into, or leave one engine-owned alliance per agent. The engine assigns one of four accessible display colors while preserving individual ownership and permanent base colors. Allied territory cannot be captured. Observations retain the existing bounded public/direct windows plus authoritative proposals, alliance events, and individual/alliance territory totals. Minimal, Standard, Full safe, and Custom schema-v5 exports preserve the decoupled communication model and add diplomacy/alliance state, events, and metrics. Reset clears world/alliance progress while preserving all eight edited personalities; Restore Defaults reinstates the exact eight milestone defaults without changing progress.

Export previews report exact serialized UTF-8 bytes and a model-agnostic `ceil(bytes / 4)` approximate AI-input-token estimate. Compact JSON is the default for AI sharing; Pretty JSON remains available for human review, and preview estimates reflect the selected serialization. This is a sharing-budget aid, not tokenizer output or a billing guarantee. Exports exclude fixed prompts, raw provider payloads, credentials, authorization headers, private reasoning, and unbounded diagnostics.

## Opt-in real-provider smoke

The smoke command performs exactly one bounded real decision request and validates it. It is never part of default tests or CI:

```bash
pnpm smoke:openrouter
```

The command uses Node 24's built-in environment parser to read only `OPENROUTER_API_KEY` and `AGENTBORNE_MODEL` from the repository-root `.env`. Values in that file override stale exported values for the smoke process.

## Development map source

The map centers on Toledo, Ohio (`41.6528, -83.5379`) at H3 resolution 9 and renders a deterministic radius-six disk of exactly 127 cells with eight fixed perimeter starts. MapLibre uses the public OpenStreetMap raster tile endpoint with attribution for light local development only. A public deployment must choose a compliant production tile source.

Alliance leadership, merging, custom metadata, combat systems, relationship scores, group chat, persistent memory, player mechanics, persistence, autonomous scheduling, and provider configuration UI remain deferred.

When every development cell is infected, World Lab automatically pauses playback and disables Start to avoid accidental provider calls. Reset and export remain available, and Single turn remains an explicitly manual diagnostic action.

World Lab also provides a browser-owned **Run to turn 200** control. It continues the existing sequential loop only for the remaining turns, displays progress, and pauses immediately after total completed turn 200 unless full infection stops it first.

See [Testing](docs/TESTING.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), and the [Roadmap](ROADMAP.md).
