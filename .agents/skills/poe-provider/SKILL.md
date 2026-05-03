---
name: poe-provider
description: "Complete reference for integrating with Poe as an AI model provider. Use when: (1) Configuring Poe as a provider for coding agents (Claude Code, Codex, OpenCode, Kimi), (2) Setting up Poe API authentication with API keys or OAuth, (3) Querying AI models — prefer the Responses API first, then the Anthropic-compatible Messages API for Claude models, then Chat Completions for OpenAI SDK compatibility, (4) Generating images, videos, or audio through Poe, (5) Managing API usage and compute points billing, (6) Configuring Poe's MCP server for model access, (7) Using Poe as a drop-in replacement for the Anthropic API / Claude Code provider, (8) Users mention Poe subscriptions, model access, or wanting to use Poe with their favorite AI tools. Triggers especially when users say 'use Poe', 'Poe API', 'poe-code', 'configure AI provider', 'Anthropic compatible', 'Claude Code with Poe', or need to access models through Poe."
---

# Poe Provider Integration

Poe provides unified access to hundreds of AI models from multiple providers through a single API. This skill covers authentication, API usage, content generation, and best practices for integrating with Poe.

---

## ⚠️ Critical Poe Gotchas (Read First!)

**These are the mistakes agents make repeatedly without explicit guidance:**

| Gotcha | Wrong | Correct |
|--------|-------|---------|
| **Env var name** | `OPENAI_API_KEY` | `POE_API_KEY` |
| **API key prefix** | `sk-...` or `your-key` | `poe-xxxxx-...` |
| **Base URL** | `api.openai.com` | `api.poe.com/v1` |
| **Anthropic base URL** | `api.anthropic.com` | `api.poe.com` |
| **Model names** | `gpt-4`, `claude-3` | `claude-3-5-sonnet`, `gpt-4o` |
| **Billing** | Tokens | Compute points |
| **Auth header** | Varies by endpoint | See below |
| **Chat Completions mode** | Assume permissive validation forever | Test with `poe-feature: chat-completions-strict`; use spec-only fields and treat legacy mode as temporary |

---

## Quick Setup (3 Steps)

### 1. Get Your API Key

```bash
# Visit https://poe.com/api while logged in
# Click "Create API Key"
# Copy the key (it starts with poe-)
```

### 2. Set Environment Variable

```bash
export POE_API_KEY=poe-xxxxx-your-key-here
```

### 3. Verify It Works

```bash
poe-code auth status
```

---

## Switching from OpenAI SDK

**This is the fastest way to use Poe with existing code:**

```typescript
// ❌ Wrong - OpenAI
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Correct - Poe (just add baseURL!)
import OpenAI from 'openai';
const client = new OpenAI({ 
  baseURL: 'https://api.poe.com/v1',
  apiKey: process.env.POE_API_KEY 
});
```

**Python:**
```python
# Same pattern - just add base_url
from openai import OpenAI
client = OpenAI(
    base_url="https://api.poe.com/v1",
    api_key=os.environ.get("POE_API_KEY")
)
```

### Model Name Mapping

| OpenAI | Poe Equivalent |
|--------|---------------|
| `gpt-4o` | `claude-3-5-sonnet` or `gpt-4o` |
| `gpt-4-turbo` | `claude-3-5-sonnet` |
| `gpt-3.5-turbo` | `claude-3-haiku` |
| `o1-preview` | `o1-preview` |

---

## Poe Code CLI (Essential Tool)

Poe provides a powerful CLI for managing Poe integration:

### Core Commands

```bash
# Install
npm install -g poe-code

# Check balance
poe-code usage

# View usage history
poe-code usage list --pages 5

# List available models
poe-code models
poe-code models --search claude

# Wrap Claude Code with Poe
poe-code wrap claude

# One-off prompt
poe-code spawn claude "Fix the bug in auth.ts"

# Spawn against GitHub repo
poe-code spawn codex "Review auth module" --cwd github://owner/repo
```

### MCP Server Setup

```bash
# Configure Claude Code to use Poe MCP
npx poe-code@latest mcp configure claude-code

# Available MCP tools:
# - generate_text  (query any Poe bot)
# - generate_image
# - generate_video
# - generate_audio
```

---

## API Selection Guide

Poe exposes three APIs. **Always use the highest-priority API that fits your use case.**

| Priority | API | Use When | Why |
|----------|-----|----------|-----|
| **1st** | **Responses API** | Any model, any task — but see caveats below | Most feature-rich endpoint (reasoning, structured outputs, web search). **Caveat:** `instructions` and `previous_response_id` are currently broken on Poe (tested 2026-04-13) — may be temporary |
| **2nd** | **Messages API** (Anthropic-compatible) | Claude/Anthropic models, or when integrating with the Anthropic SDK | Drop-in replacement for `api.anthropic.com`, native Claude tool use format |
| **3rd** | **Chat Completions API** (OpenAI-compatible) | OpenAI SDK users, or when you need `role: "system"` / reliable multi-turn | Fully working through Poe — system messages, tool calling (including parallel), agentic loops, streaming, multi-turn, and image input all confirmed. Use this when Responses API gaps matter for your integration. |

### ⚠️ Responses API Platform Gaps (tested 2026-04-13, may be temporary)

The Responses API is the most feature-rich endpoint but currently has two significant gaps through Poe:
- **`instructions` is silently ignored** — accepted but has no effect on any provider
- **`previous_response_id` returns errors** — 500 for Claude, data-retention rejection for GPT

Workaround: inject system context in the `input` array; use `input` array for multi-turn history. See `references/responses-api.md` for details.

### Chat Completions — More Reliable Than You'd Expect

Despite being listed as 3rd priority, Chat Completions actually has **fewer platform gaps** than the Responses API right now. Tested against both `Claude-Haiku-4.5` and `gpt-5.4-mini` on 2026-04-13:

| Feature | Status |
|---------|--------|
| Basic text | ✅ |
| System messages (`role: "system"`) | ✅ |
| Tool calling | ✅ |
| Parallel tool calls | ✅ |
| Agentic loop (tool result roundtrip) | ✅ |
| Multi-turn (message history) | ✅ |
| Streaming | ✅ |
| Image input | ✅ |
| Strict mode header | ✅ |
| `temperature`, `max_tokens` | ✅ |

Use Chat Completions when you need `role: "system"` or reliable multi-turn and don't want to work around the Responses API gaps.

### Chat Completions Strict Validation Rollout

Poe is rolling `/v1/chat/completions` toward **strict OpenAI-compatible request validation**. Non-standard fields like `extra_body` that previously worked may now fail.

1. Check `GET https://api.poe.com/v1/models` — confirm the model lists `/v1/chat/completions` in `supported_endpoints`
2. Test with `poe-feature: chat-completions-strict`
3. Inspect `x-poe-feature-active` on the response to confirm which mode handled the request
4. Use `chat-completions-legacy` only as a temporary migration fallback
5. If the user needs provider-specific parameters, move to `/v1/responses` or the first-party provider API

---

### Responses API (Primary Choice)

```bash
curl -X POST "https://api.poe.com/v1/responses" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "Claude-Sonnet-4.6", "input": "Your question"}'
```

### Messages API (Anthropic-Compatible — Secondary Choice for Claude Models)

```bash
curl -X POST "https://api.poe.com/v1/messages" \
  -H "x-api-key: $POE_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Ideal for**: Claude Code, Anthropic SDK integrations, or any tool that already speaks the Anthropic API protocol. Just swap `ANTHROPIC_BASE_URL` → `https://api.poe.com` and `ANTHROPIC_API_KEY` → your Poe key.

### Chat Completions API

```bash
curl -X POST "https://api.poe.com/v1/chat/completions" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Use when**: you need the OpenAI SDK shape, or when `instructions`/`previous_response_id` gaps on the Responses API matter for your integration. System messages, multi-turn, tools, streaming, and image input all work reliably.

**Strict validation note**: Poe announced a strict-validation migration window for `/v1/chat/completions`, with legacy fallback scheduled to end on **2026-04-24**. Read `references/feature-flags.md` before advising on migrations, validation errors, or `extra_body` / custom-parameter issues.

### Auth Header by Endpoint

| Endpoint | Header |
|----------|--------|
| `/v1/responses` | `Authorization: Bearer $POE_API_KEY` |
| `/v1/messages` | `x-api-key: $POE_API_KEY` _or_ `Authorization: Bearer $POE_API_KEY` |
| `/v1/chat/completions` | `Authorization: Bearer $POE_API_KEY` |
| `/bot/*` | `Poe-API-Key: $POE_API_KEY` (legacy, for content generation) |

---

## Authentication

### API Key (Simplest)

```bash
# Environment variable
export POE_API_KEY=poe-xxxxx

# Or use poe-code login (opens browser)
npx poe-code@latest login
```

### OAuth PKCE (For User-Facing Apps)

```typescript
import { poeOAuth } from 'poe-oauth';

// 1. Create auth URL
const { authorizationUrl } = await poeOAuth.createAuthCode({
  callbackUrl: 'https://yourapp.com/callback'
});
res.redirect(authorizationUrl);

// 2. Exchange code for key
const { key } = await poeOAuth.exchangeCode({ code: req.query.code });
```

---

## Usage & Billing

**Poe uses compute points**, not tokens. Monitor usage:

```bash
# Check balance
poe-code usage

# View history
poe-code usage list --pages 5

# Filter by model
poe-code usage list --filter claude
```

### Point Costs (Relative)

| Type | Relative Cost |
|------|---------------|
| Text (100 tokens) | 1x |
| Image (1024x1024) | ~10x |
| Video (5 sec) | ~50x |

---

## Error Handling

### Quick Reference

| Status | Meaning | Fix |
|--------|---------|-----|
| **401** | Invalid API key | Check `POE_API_KEY`, regenerate key |
| **403** | No permission | Upgrade subscription |
| **404** | Model not found | Use `poe-code models` to verify name |
| **429** | Rate limited | Wait, implement backoff |

### 401 vs 403

- **401 Unauthorized**: Your API key is wrong or expired
- **403 Forbidden**: Your subscription doesn't cover this

### Retry Pattern

```typescript
async function retryWithBackoff(fn: () => Promise<Response>, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fn();
    if (response.ok) return response;
    if (response.status === 429 || response.status >= 500) {
      await sleep(Math.pow(2, i) * 1000);
      continue;
    }
    throw new Error(`HTTP ${response.status}`);
  }
}
```

---

## Content Generation

### Image Generation

```bash
curl -X POST "https://api.poe.com/bot/dalle-3" \
  -H "Poe-API-Key: $POE_API_KEY" \
  -d '{"query": "A sunset over mountains", "image_size": "1024x1024"}'
```

**Sizes:** `1024x1024` (square), `1792x1024` (landscape), `1024x1792` (portrait)  
**Styles:** `vivid` (enhanced), `natural` (realistic)

### Video Generation

```bash
curl -X POST "https://api.poe.com/bot/video-generator" \
  -H "Poe-API-Key: $POE_API_KEY" \
  -d '{"query": "Ocean waves crashing"}'
```

### Audio (TTS)

```bash
curl -X POST "https://api.poe.com/bot/audio-tts" \
  -H "Poe-API-Key: $POE_API_KEY" \
  -d '{"query": "Hello!", "voice": "alloy"}'
```

**Voices:** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

---

## Gotchas (Additional)

- **OAuth requires subscription**: Users need Poe Pro subscription for API access
- **Rate limits vary by tier**: Check `poe-code usage` for your limits
- **Streaming errors**: Wrap in try/catch, handle incomplete streams
- **Model availability**: Not all models available via API (some web-only)

---

## Reference Files

| File | Priority | When to Read |
|------|----------|--------------|
| `references/responses-api.md` | **1st** | Full Responses API reference (reasoning, web search, structured outputs, streaming, tool use) |
| `references/anthropic-api.md` | **2nd** | Anthropic-compatible Messages API (Claude Code, Anthropic SDK, tool use) |
| `references/chat-completions-api.md` | **3rd** | Chat Completions API — fully working (system messages, tools, multi-turn, streaming, images). Prefer when Responses API gaps matter. |
| `references/feature-flags.md` | — | `/v1/chat/completions` rollout guidance: strict vs legacy headers, response confirmation, and migration steps |
| `references/authentication.md` | — | OAuth flow, Poe-specific auth gotchas |
| `references/models.md` | — | Full model catalog |
| `references/costs_and_usage.md` | — | Compute point balance, usage history API, pagination patterns |
| `references/cache.md` | — | Prompt caching: what works, what doesn't, point savings, per-endpoint guide |
| `references/errors.md` | — | Error codes and debugging |
