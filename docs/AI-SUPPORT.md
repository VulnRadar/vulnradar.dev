# VulnRadar AI Support Widget

A floating chat widget available on all pages. Lets users ask questions about their scan results, get fix guidance, or get help with the API and self-hosting.

## How it works

- Floating button (bottom-right corner) on every page
- Streams responses via any OpenAI-compatible API endpoint
- Chat history persists in `localStorage` for 7 days — nothing is stored server-side
- Works with cloud providers (OpenAI, Groq, Mistral, OpenRouter) and local LLMs (Ollama, LM Studio)

## Setup

Set `AI_BASE_URL` and `AI_MODEL` in your `.env` or `.env.local`:

```env
# The OpenAI-compatible endpoint (required)
AI_BASE_URL=https://api.openai.com/v1

# Model to use (required)
AI_MODEL=gpt-4o-mini

# API key — required for cloud providers, omit or set to "ollama" for local
AI_API_KEY=sk-...

# Optional: max tokens per response (default 1024)
AI_MAX_TOKENS=1024
```

## Provider examples

### OpenAI

```env
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
```

### Ollama (local — no key needed)

```env
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.2
# AI_API_KEY can be omitted
```

Run `ollama pull llama3.2` first if you haven't already.

### LM Studio (local)

```env
AI_BASE_URL=http://localhost:1234/v1
AI_MODEL=local-model
# AI_API_KEY can be omitted
```

### Groq (fast free tier)

```env
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
AI_API_KEY=gsk_...
```

### OpenRouter (access to 200+ models)

```env
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=anthropic/claude-3-haiku
AI_API_KEY=sk-or-...
```

### Mistral

```env
AI_BASE_URL=https://api.mistral.ai/v1
AI_MODEL=mistral-small-latest
AI_API_KEY=...
```

### DeepSeek

```env
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_API_KEY=...
```

### Anthropic (native API)

```env
AI_BASE_URL=https://api.anthropic.com/v1
AI_MODEL=claude-haiku-4-5-20251001
AI_API_KEY=sk-ant-...
```

### Legacy: AI_PROVIDER shorthand

If you don't set `AI_BASE_URL`, the route will fall back to `AI_PROVIDER`:

| Value        | Maps to                          |
| ------------ | -------------------------------- |
| `openai`     | `https://api.openai.com/v1`      |
| `anthropic`  | `https://api.anthropic.com/v1`   |
| `groq`       | `https://api.groq.com/openai/v1` |
| `mistral`    | `https://api.mistral.ai/v1`      |
| `openrouter` | `https://openrouter.ai/api/v1`   |
| `ollama`     | `http://localhost:11434/v1`      |
| `lmstudio`   | `http://localhost:1234/v1`       |
| `together`   | `https://api.together.xyz/v1`    |
| `deepseek`   | `https://api.deepseek.com/v1`    |
| `minimax`    | `https://api.minimax.chat/v1`    |

## Customizing the system prompt

Edit `lib/ai/system-prompt.ts` — the `VULNRADAR_SYSTEM_PROMPT` string controls what the AI knows and how it responds.

The prompt includes a `SELF-HOSTING TARGETS` section with explicit guidance for the four common deployment targets the AI sees in support tickets:

- **Pterodactyl panel** — recommended default when the user mentions a panel. Mount at `/var/www/html`, run `docker compose up -d`, bind-mount postgres data so panel backups work, use Caddy reverse proxy inside the panel.
- **Generic Docker compose** — bare Linux / VPS / home server. `git clone` + `.env` + `docker compose up -d` + Caddy/nginx in front.
- **Kubernetes / K3s** — stateless app scales horizontally; postgres via Bitnami or CloudNativePG chart.
- **Render / Fly.io / Railway** — managed PaaS, the right answer when the user explicitly says they don't want to manage servers.

The prompt explicitly tells the model: "If the user mentions Pterodactyl → give the panel+Docker compose path. Do NOT recommend a paid VPS unless they explicitly ask."

CLI install command reference (for Pterodactyl users following the panel's CLI installer):

```bash
bash install.sh --version 1-13-1
```

(`1-13-1` is just an example; the real path is `bash install.sh` against the latest release from <https://github.com/VulnRadar/vulnradar.dev/releases>.)

If you want to extend the deployment knowledge, append a new section to `VULNRADAR_SYSTEM_PROMPT` in `lib/ai/system-prompt.ts` following the existing `━━━ HEADER ━━━` style.

## API route

`POST /api/v3/ai/chat`

Body:

```json
{
  "messages": [{ "role": "user", "content": "What is hsts-missing?" }]
}
```

Returns `text/plain` streaming response (raw text chunks, no SSE envelope).

## Architecture

- `lib/ai/system-prompt.ts` — system prompt and VulnRadar context
- `app/api/v3/ai/chat/route.ts` — streaming proxy, SSE parsing, provider resolution
- `components/ai-chat/chat-widget.tsx` — floating button and chat panel
- `app/layout.tsx` — mounts the widget on every page
