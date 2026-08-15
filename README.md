# Agentborne

Agentborne is the working title for an agent-first GPS containment game. Six persistent, named model-backed agents move, infect, capture contested territory, wait, and optionally communicate in the same inference in a real Toledo H3 world while the World Lab exposes every safe decision record.

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

State is held only in the Game API process. The API captures one active safe experiment with up to 5,000 complete turn records while the browser snapshot remains capped at 120. Every provider decision contains one required world action—move, infect, capture, or wait—and at most one optional communication. Public messages reach every agent; direct messages require a distinct existing recipient within inclusive pre-action H3 distance three. Both components are validated independently, remain attached to one turn, and use one provider call. Message text is authoritatively trimmed and bounded to 1–280 characters. Observations contain the latest 12 public messages and latest six relevant inbound/outbound direct messages. Every infected hex has exactly one individual controller, and the existing capture rules remain unchanged. The six default personalities are unchanged. Minimal, Standard, Full safe, and Custom schema-v4 exports filter the same safe retained experiment without changing prompts or inference usage. OpenRouter's returned `usage.cost` is shown as known cost; missing cost remains explicitly unknown. Restarting the API loses the experiment. Reset clears public/direct history and metrics, creates a new experiment identity and open Toledo world, and preserves active personalities.

Export previews report exact serialized UTF-8 bytes and a model-agnostic `ceil(bytes / 4)` approximate AI-input-token estimate. Compact JSON is the default for AI sharing; Pretty JSON remains available for human review, and preview estimates reflect the selected serialization. This is a sharing-budget aid, not tokenizer output or a billing guarantee. Exports exclude fixed prompts, raw provider payloads, credentials, authorization headers, private reasoning, and unbounded diagnostics.

## Opt-in real-provider smoke

The smoke command performs exactly one bounded real decision request and validates it. It is never part of default tests or CI:

```bash
pnpm smoke:openrouter
```

The command uses Node 24's built-in environment parser to read only `OPENROUTER_API_KEY` and `AGENTBORNE_MODEL` from the repository-root `.env`. Values in that file override stale exported values for the smoke process.

## Development map source

The map centers on Toledo, Ohio (`41.6528, -83.5379`) at H3 resolution 9 and renders a radius-four disk. MapLibre uses the public OpenStreetMap raster tile endpoint with attribution for light local development only. A public deployment must choose a compliant production tile source.

Formal alliances, combat systems, relationships, group chat, persistent memory, player mechanics, persistence, autonomous scheduling, and provider configuration UI remain deferred to later roadmap milestones.

When every development cell is infected, World Lab automatically pauses playback and disables Start to avoid accidental provider calls. Reset and export remain available, and Single turn remains an explicitly manual diagnostic action.

See [Testing](docs/TESTING.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), and the [Roadmap](ROADMAP.md).
