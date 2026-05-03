# Anthropic Compatible API

The Poe API provides access to Claude models through an Anthropic-compatible endpoint. Use your Poe API key to access Claude without needing a separate Anthropic API key.

**Key benefits:**
- Use your existing Poe subscription points with no additional setup
- Drop-in replacement for the Anthropic API - works with existing Anthropic SDK code
- Requests are proxied directly to the provider with minimal transformation

If you're already using the Anthropic SDK, you can switch to using Poe by simply changing the base URL and API key. For full API reference, see [Anthropic's official documentation](https://docs.anthropic.com/en/api/messages).

---

## Endpoint

```
POST https://api.poe.com/v1/messages
```

Only official Anthropic bots are supported through this API. You cannot call custom bots or bots from other providers. For other bots, use the Responses API or Chat Completions API.

---

## Authentication

```bash
curl "https://api.poe.com/v1/messages" \
    -H "x-api-key: $POE_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json"
```

The `anthropic-version` header is required.

---

## Claude Code Setup

Set two environment variables to route Claude Code through Poe:

```bash
export ANTHROPIC_API_KEY=$POE_API_KEY
export ANTHROPIC_BASE_URL="https://api.poe.com"
```

Restart Claude Code and verify with the `/status` command.

---

## Request Format

### Minimal Request

```json
{
  "model": "claude-sonnet-4.6",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "What are the top 3 things to do in NYC?"}
  ]
}
```

### Full Request

```json
{
  "model": "claude-sonnet-4.6",
  "max_tokens": 4096,
  "messages": [
    {"role": "user", "content": "Explain quantum computing"}
  ],
  "system": "You are a helpful physics tutor.",
  "temperature": 0.7,
  "top_p": 1.0,
  "stream": false,
  "stop_sequences": ["\n\nEND"]
}
```

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | Required | Model identifier |
| `max_tokens` | int | Required | Maximum tokens in the response |
| `messages` | array | Required | Conversation messages |
| `system` | string/array | null | System prompt |
| `temperature` | float | 1.0 | Sampling randomness (0.0–1.0) |
| `top_p` | float | null | Nucleus sampling |
| `top_k` | int | null | Top-K sampling |
| `stream` | boolean | false | Enable streaming with SSE |
| `stop_sequences` | array | null | Custom stop sequences (max 10) |
| `metadata` | object | null | User metadata (user_id) |
| `tools` | array | null | Tool definitions |
| `tool_choice` | object/string | null | Tool selection strategy |

### system Parameter

Can be a plain string or structured array for multi-part prompts:

```json
"system": [
  {"type": "text", "text": "You are a helpful assistant."},
  {"type": "text", "text": "Always respond in French.", "cache_control": {"type": "ephemeral"}}
]
```

---

## Message Format

### Roles

| Role | Description |
|------|-------------|
| `user` | Human messages |
| `assistant` | AI responses (for multi-turn) |

System prompts go in the top-level `system` field, not in the messages array.

### Text Content

```json
{"role": "user", "content": "What is machine learning?"}
```

### Multimodal Content (Images)

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "What's in this image?"},
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUg..."
      }
    }
  ]
}
```

Or by URL:

```json
{
  "type": "image",
  "source": {
    "type": "url",
    "url": "https://example.com/photo.jpg"
  }
}
```

Supported types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.

---

## Tool Use

### Defining Tools

```json
{
  "model": "claude-sonnet-4.6",
  "max_tokens": 4096,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather for a location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "City name"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "Temperature unit"
          }
        },
        "required": ["location"]
      }
    }
  ],
  "messages": [
    {"role": "user", "content": "What's the weather in Paris?"}
  ]
}
```

### Tool Use Response

When the model calls a tool:

```json
{
  "content": [
    {
      "type": "text",
      "text": "I'll check the weather in Paris for you."
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": {"location": "Paris", "unit": "celsius"}
    }
  ],
  "stop_reason": "tool_use",
  "model": "claude-sonnet-4.6",
  "usage": {
    "input_tokens": 250,
    "output_tokens": 50
  }
}
```

### Continuing After Tool Use

Send tool results back as a `tool_result` content block in a `user` message:

```json
"messages": [
  {"role": "user", "content": "What's the weather in Paris?"},
  {"role": "assistant", "content": [
    {"type": "tool_use", "id": "toolu_01A09q90qw90lq917835lq9", "name": "get_weather", "input": {"location": "Paris", "unit": "celsius"}}
  ]},
  {"role": "user", "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "{\"temperature\": 22, \"conditions\": \"Sunny\"}"
    }
  ]}
]
```

### tool_choice Options

| Value | Behavior |
|-------|----------|
| `"auto"` | Model decides (default) |
| `"any"` | Model must use at least one tool |
| `{"type": "tool", "name": "get_weather"}` | Force a specific tool |

### Agentic Loop

Models can chain multiple tool calls for complex workflows:

```python
import json

def execute_tool(tool_name, tool_input):
    if tool_name == "get_weather":
        return json.dumps({"temperature": 72, "conditions": "sunny"})
    return "Unknown tool"

messages = [
    {"role": "user", "content": "What's the weather in Paris and London?"}
]

max_iterations = 10
for i in range(max_iterations):
    response = client.messages.create(
        model="claude-sonnet-4.6",
        max_tokens=4096,
        tools=TOOLS,
        messages=messages
    )

    tool_uses = [b for b in response.content if b.type == "tool_use"]

    if not tool_uses:
        for block in response.content:
            if block.type == "text":
                print(f"Final response: {block.text}")
        break

    messages.append({"role": "assistant", "content": response.content})

    for tool_use in tool_uses:
        print(f"Calling {tool_use.name} with {tool_use.input}")
        result = execute_tool(tool_use.name, tool_use.input)
        messages.append({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": result
            }]
        })
```

---

## Streaming

### Request

```json
{
  "model": "claude-sonnet-4.6",
  "max_tokens": 1024,
  "stream": true,
  "messages": [
    {"role": "user", "content": "Write a haiku about coding"}
  ]
}
```

### Streaming Response Format

Server-Sent Events:

```
event: message_start
data: {"type": "message_start", "message": {"id": "msg_...", "type": "message", "role": "assistant", "content": [], "model": "claude-sonnet-4.6", "usage": {"input_tokens": 10, "output_tokens": 0}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " world"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 50}}

event: message_stop
data: {"type": "message_stop"}
```

### SSE Event Types

| Event | Description |
|-------|-------------|
| `message_start` | Beginning of response |
| `content_block_start` | New content block |
| `content_block_delta` | Incremental text or tool input |
| `content_block_stop` | Content block complete |
| `message_delta` | Stop reason and final usage |
| `message_stop` | Response complete |
| `ping` | Keep-alive |

### Client Implementation

```typescript
async function* streamMessages(messages: any[], model: string) {
  const response = await fetch('https://api.poe.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.POE_API_KEY!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      messages
    })
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta') {
            yield parsed.delta;
          }
        } catch {}
      }
    }
  }
}

// Usage
for await (const delta of streamMessages(
  [{ role: 'user', content: 'Hello' }],
  'claude-sonnet-4.6'
)) {
  if (delta.type === 'text_delta') {
    process.stdout.write(delta.text);
  }
}
```

---

## Response Format

### Non-Streaming

```json
{
  "id": "msg_01XFDUDYJhyAAC8vn8option",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "model": "claude-sonnet-4.6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15
  }
}
```

### Content Block Types

**Text content block:**
```json
{
  "type": "text",
  "text": "Hello! How can I help you today?"
}
```

**Tool use content block:**
```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "get_weather",
  "input": {"location": "Paris", "unit": "celsius"}
}
```

### Stop Reasons

| Reason | Meaning |
|--------|---------|
| `end_turn` | Natural end of response |
| `max_tokens` | Hit `max_tokens` limit |
| `stop_sequence` | Hit a custom stop sequence |
| `tool_use` | Model requested tool execution |

---

## Supported Models

Use either the Poe bot name or the Anthropic API model name:

| Model | Poe Bot Name | Anthropic API Name |
|-------|-------------|-------------------|
| Claude Sonnet 4.6 | `claude-sonnet-4.6` | `claude-sonnet-4.6` |
| Claude Opus 4.6 | `claude-opus-4.6` | `claude-opus-4-6` |
| Claude Haiku 4.5 | `claude-haiku-4.5` | `claude-haiku-4-5` |

Only official Anthropic models are available on this endpoint. For custom bots or other providers, use the Responses API or Chat Completions API.

---

## Error Handling

Errors follow the [Anthropic error format](https://docs.anthropic.com/en/api/errors):

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "Invalid API key"
  }
}
```

| Type | Status | Description |
|------|--------|-------------|
| `invalid_request_error` | 400 | Invalid request - Malformed request or missing required fields |
| `authentication_error` | 401 | Authentication failed - Invalid API key |
| `not_found_error` | 404 | Model not found - Only Claude models are supported |
| `rate_limit_error` | 429 | Rate limit exceeded (500 requests per minute) |

---

## Rate Limits

**500 requests per minute (rpm)**

---

## Anthropic SDK Compatibility

Since this is a pass-through to the Anthropic API, official Anthropic SDKs work with just a base URL change.

### Python

```python
import anthropic

client = anthropic.Anthropic(
    api_key=os.environ.get("POE_API_KEY"),
    base_url="https://api.poe.com"
)

message = client.messages.create(
    model="claude-sonnet-4.6",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude!"}
    ]
)
```

### Node.js

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.POE_API_KEY,
  baseURL: 'https://api.poe.com'
});

const message = await client.messages.create({
  model: 'claude-sonnet-4.6',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Hello, Claude!' }
  ]
});
```

---

## Migration Checklist (Anthropic → Poe)

1. **Swap base URL**: `https://api.anthropic.com` → `https://api.poe.com`
2. **Replace API key**: `ANTHROPIC_API_KEY` → `POE_API_KEY`
3. **Run your code** — Everything else stays the same

Request/response formats, streaming events, tool use, and error handling are identical to the Anthropic API.
