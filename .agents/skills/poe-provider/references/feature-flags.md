# Poe Feature Flags and Chat Completions Migration

Use this file whenever a user is integrating with `/v1/chat/completions`, migrating older Poe code, or hitting validation errors after previously sending non-standard request fields.

---

## Why this matters

Poe is moving `/v1/chat/completions` from a permissive compatibility layer to **strict OpenAI-compatible request validation**.

That change is meant to reduce Poe-specific request transformations and make the endpoint behave more like the first-party API. In practice, older requests that relied on compatibility behavior may now fail.

Common risk areas:
- `extra_body`
- Older Poe-side renamed or translated parameters
- Any field outside the OpenAI Chat Completions schema

If the user needs provider-native parameters such as reasoning controls, do **not** keep stuffing them into Chat Completions. Move the integration to `/v1/responses` or the provider's first-party API instead.

---

## Rollout phases

Poe announced this rollout in three phases:

1. **Early access**
   - Default behavior: legacy permissive mode
   - Opt in with `poe-feature: chat-completions-strict`

2. **Default strict**
   - Default behavior: strict mode
   - Temporary opt out with `poe-feature: chat-completions-legacy`

3. **Grace period ends**
   - Strict mode only
   - Legacy header ignored

Poe said the legacy fallback is scheduled to end on **2026-04-24**.

---

## Request header: `poe-feature`

Send a comma-separated list of feature flags:

```http
poe-feature: chat-completions-strict, messages-v2
```

Rules:
- Multiple flags are comma-separated
- Each endpoint only looks at relevant flags
- Unknown flags are ignored
- If the header is absent, current rollout defaults apply

### Chat Completions flags

- `chat-completions-strict` — opt into strict validation early
- `chat-completions-legacy` — stay on the permissive handler temporarily during migration

---

## Response header: `x-poe-feature-active`

Every response includes the active mode that served the request:

```http
x-poe-feature-active: chat-completions-strict
```

Use this to confirm whether the request actually ran in strict or legacy mode.

---

## Migration checklist

1. **Check that the model supports this endpoint**
   - Call `GET https://api.poe.com/v1/models`
   - Look for `/v1/chat/completions` in `supported_endpoints`

2. **Remove non-standard request fields**
   - Especially `extra_body`
   - Also remove older Poe-only aliases or translated parameters

3. **Test in strict mode now**
   - Send `poe-feature: chat-completions-strict`

4. **Confirm the active mode**
   - Inspect `x-poe-feature-active`

5. **Use legacy mode only as a temporary fallback**
   - `poe-feature: chat-completions-legacy`
   - Do not build long-term logic around it

6. **Prefer `/v1/responses` when you need advanced features**
   - Reasoning controls
   - Structured outputs
   - Built-in tools like web search
   - Other provider-native configuration that does not cleanly fit the Chat Completions schema

---

## Example: strict-mode curl request

```bash
curl "https://api.poe.com/v1/chat/completions" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "poe-feature: chat-completions-strict" \
  -d '{
    "model": "Claude-Sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## Guidance for agents updating user code

When a user says an older Poe Chat Completions integration "used to work" but now fails:

1. Look for `extra_body` or other non-standard fields first
2. Add the strict header in testing so behavior is explicit
3. Check `x-poe-feature-active` in the response
4. If the request depends on provider-specific knobs, migrate it to `/v1/responses`
5. Explain that Poe is intentionally removing old request transformations to match first-party API behavior more closely
