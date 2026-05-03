# Poe Responses API Reference

The Responses API is Poe's primary OpenAI-compatible interface for AI text generation. It provides advanced capabilities beyond Chat Completions: built-in reasoning, web search, structured outputs, multi-turn conversations via `previous_response_id`, and multi-modal inputs (text, images).

**Note:** Poe UI-specific system prompts are skipped when using the API.

---

## ⚠️ Known Platform Gaps (tested 2026-04-13)

These are features that are part of the OpenAI Responses API spec but currently **do not work through Poe**, even though Poe accepts the fields without error. They may be temporary — Poe is actively evolving the Responses API endpoint. Check back if you hit issues.

| Feature | Status | Workaround |
|---------|--------|------------|
| `instructions` (system prompt) | **Silently ignored** — the field is accepted but has no effect on model behavior for any provider (tested Claude-Haiku-4.5, gpt-5.4-mini) | Inject system context in the `input` array, e.g. `{"role": "user", "content": "<system instructions>"}` before the real user message, or try `{"role": "developer", "content": "..."}` |
| `previous_response_id` | **Broken** — returns `500 Internal Server Error` for Claude models, and `"Previous response cannot be used for this organization due to Zero Data Retention"` for OpenAI models | Send the full conversation history as an `input` array with `role`-tagged messages |

### Confirmed working (both Claude-Haiku-4.5 and gpt-5.4-mini)

| Feature | Result |
|---------|--------|
| Basic text generation | ✅ |
| Streaming (SSE `output_text.delta` events) | ✅ |
| Tool calling (`function_call` with args) | ✅ |
| Agentic loop (send `function_call` + `function_call_output` back in `input`) | ✅ |
| Structured output (`json_schema`) | ✅ |
| Multi-turn via `input` array (role-based messages) | ✅ |
| Image input (`input_image` with base64 data URI) | ✅ |

### Model-specific notes

- **Claude** models tend to give verbose safety lectures when conversation history looks synthetic (e.g., injected `assistant` messages about "secret codes"). They work correctly with natural-looking context.
- **GPT** models are more terse and just answer, even with synthetic-looking history.

---

## Endpoint

```
POST https://api.poe.com/v1/responses
```

### Authentication

```bash
curl "https://api.poe.com/v1/responses" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json"
```

---

## Why Responses Over Chat Completions?

| Feature | Responses API | Chat Completions |
|---------|--------------|------------------|
| Reasoning / extended thinking | ✅ `reasoning` param | ❌ |
| Web search built-in | ✅ `web_search_preview` tool | ❌ |
| Structured outputs (JSON schema) | ✅ `text.format` | ❌ |
| Multi-modal inputs (text, images) | ✅ `input` array | ❌ |
| Multi-turn without resending history | ✅ `previous_response_id` | ❌ |
| Tool support | ✅ | ✅ (but limited) |

---

## Request Format

### Minimal Request

```json
{
  "model": "Claude-Sonnet-4.6",
  "input": "What are the top 3 things to do in NYC?"
}
```

### Full Request Options

```json
{
  "model": "Claude-Sonnet-4.6",
  "input": "Explain quantum computing",
  "instructions": "You are a helpful physics tutor",
  "temperature": 0.7,
  "max_output_tokens": 2048,
  "stream": false
}
```

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | **Required** | Poe bot name (e.g., `Claude-Sonnet-4.6`, `GPT-5.4`). Poe UI-specific system prompts are skipped. |
| `input` | string \| object[] | **Required** | User message. Can be a simple string or an array of input items including text, images, and previous assistant messages. |
| `instructions` | string \| null | null | System (or developer) message inserted at the beginning of the model's context |
| `temperature` | float | null | Sampling temperature (0–2) |
| `top_p` | float | null | Nucleus sampling parameter (0–1) |
| `max_output_tokens` | int \| null | Model default | Max response length |
| `stream` | boolean | false | Enable streaming via SSE |
| `reasoning` | object \| null | null | Enable extended thinking |
| `tools` | array \| null | null | Tool definitions |
| `tool_choice` | string \| object | "auto" | How the model selects tools: `"auto"`, `"required"`, `"none"`, or a specific tool object |
| `parallel_tool_calls` | boolean \| null | null | Allow the model to run tool calls in parallel |
| `previous_response_id` | string \| null | null | Continue multi-turn conversation |
| `text` | object \| null | null | Configuration for structured text output (JSON schema) |
| `truncation` | string \| null | null | Truncation strategy: `"auto"` (truncate to fit context window) or `"disabled"` (fail if exceeds) |
| `include` | array \| null | null | Additional output to include. Values: `"web_search_call.action.sources"`, `"message.output_text.logprobs"`, `"reasoning.encrypted_content"` |
| `metadata` | object \| null | null | Key-value pairs for additional info (keys ≤64 chars, values ≤512 chars) |
| `service_tier` | string \| null | null | Processing tier: `"auto"`, `"default"`, `"flex"`, `"priority"` |
| `store` | boolean \| null | null | Whether to store the response for later retrieval |

---

## Reasoning

Enable extended thinking for complex tasks (works best with Claude Sonnet 4.6, o3, o4-mini):

```json
{
  "model": "Claude-Sonnet-4.6",
  "input": "Solve: if a train leaves at 3pm going 60mph and another at 4pm going 90mph, when do they meet?",
  "reasoning": {
    "effort": "high",
    "summary": "auto"
  }
}
```

### Reasoning Effort Levels

| Effort | Use Case |
|--------|----------|
| `low` | Quick, simple tasks |
| `medium` | Balanced (default) |
| `high` | Complex reasoning, math, coding |

---

## Web Search

Use the built-in `web_search_preview` tool for up-to-date information:

```json
{
  "model": "GPT-5.4",
  "input": "What are the latest AI news today?",
  "tools": [{"type": "web_search_preview"}]
}
```

---

## Structured Outputs

Get responses conforming to a specific JSON schema:

```json
{
  "model": "GPT-5.4",
  "input": "List the top 3 programming languages in 2025",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "languages",
      "schema": {
        "type": "object",
        "properties": {
          "languages": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {"type": "string"},
                "reason": {"type": "string"}
              },
              "required": ["name", "reason"]
            }
          }
        },
        "required": ["languages"]
      }
    }
  }
}
```

---

## Multi-Turn Conversations

### Via `input` array (currently recommended)

Send the full conversation history as an array of role-tagged messages. This is the reliable method through Poe today:

> **Caching note:** replaying full history does not automatically kill prompt caching. Keep the transcript append-only and byte-stable so the unchanged prefix can still be reused. See `cache.md` for best practices and cache killers to avoid.

```python
response = client.responses.create(
    model="Claude-Sonnet-4.6",
    input=[
        {"role": "user", "content": "The capital of France is Paris. The capital of Germany is Berlin."},
        {"role": "assistant", "content": "Understood, I have noted the capitals."},
        {"role": "user", "content": "What is the capital of Germany?"}
    ]
)
print(response.output_text)  # "Berlin"
```

### Via `previous_response_id` (currently broken)

> **⚠️ Platform gap (as of 2026-04-13):** `previous_response_id` returns `500` for Claude models and a data-retention error for OpenAI models. This may be temporary. Use the `input` array approach above instead.

```python
# This does NOT currently work through Poe
response = client.responses.create(
    model="Claude-Sonnet-4.6",
    input="What is the capital of France?"
)

followup = client.responses.create(
    model="Claude-Sonnet-4.6",
    input="What is its population?",
    previous_response_id=response.id  # 500 error
)
```

---

## Streaming

### Request

```json
{
  "model": "Claude-Sonnet-4.6",
  "input": "Write a story about a robot",
  "stream": true
}
```

### Streaming Response Format

Server-Sent Events:

```
data: {"type":"response_started","response":{"id":"resp_abc123","model":"Claude-Sonnet-4.6"}}

data: {"type":"content_block_started","index":0,"content_block":{"type":"text"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Once"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" upon"}}

data: {"type":"content_block_stopped"}

data: {"type":"response_done","response":{"id":"resp_abc123","usage":{"output_tokens":150}}}
```

### SSE Event Types

| Event | Description |
|-------|-------------|
| `response_started` | Response begins |
| `content_block_started` | New content block |
| `content_block_delta` | Incremental text/tool input |
| `content_block_stopped` | Block complete |
| `response_done` | Response complete with usage |
| `error` | Error occurred |

### Client Implementation

```typescript
async function* streamResponse(model: string, input: string) {
  const response = await fetch('https://api.poe.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.POE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, input, stream: true })
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
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch {}
      }
    }
  }
}

// Usage
for await (const event of streamResponse('Claude-Sonnet-4.6', 'Write a haiku')) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

---

## Tool Use

### Defining Tools

```python
TOOLS = [
    {
        "type": "function",
        "name": "plus",
        "description": "Add two integers",
        "parameters": {
            "type": "object",
            "properties": {
                "a": {"type": "integer"},
                "b": {"type": "integer"}
            },
            "required": ["a", "b"]
        }
    },
    {
        "type": "function",
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location"]
        }
    }
]
```

### Tool Calling Flow

#### Step 1: Request with Tools

```python
response = client.responses.create(
    model="Claude-Sonnet-4.6",
    input="What is 1999 + 2036? Also, what's the weather in New York?",
    tools=TOOLS
)

print(response.output)
```

**Example output** (when model requests tools):

```python
[
    {
        "type": "function_call",
        "id": "fc_abc123",
        "name": "plus",
        "arguments": {"a": 1999, "b": 2036}
    },
    {
        "type": "function_call",
        "id": "fc_def456",
        "name": "get_weather",
        "arguments": {"location": "New York"}
    }
]
```

#### Step 2: Execute Tools and Continue

Send the original user message, the function call, and the function result back as an `input` array:

```python
import json

# Build the input array with the full conversation so far
tool_results = []
func_calls = []

for output in response.output:
    if output.type == "function_call":
        call_id = output.id
        name = output.name
        args = json.loads(output.arguments) if isinstance(output.arguments, str) else output.arguments

        if name == "plus":
            result = str(args["a"] + args["b"])
        elif name == "get_weather":
            result = json.dumps({"temperature": 72, "condition": "sunny"})
        else:
            result = "Unknown tool"

        func_calls.append({
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": json.dumps(args)
        })
        tool_results.append({
            "type": "function_call_output",
            "call_id": call_id,
            "output": result
        })

followup = client.responses.create(
    model="Claude-Sonnet-4.6",
    input=[
        {"role": "user", "content": "What is 1999 + 2036? Also, what's the weather in New York?"},
        *func_calls,
        *tool_results
    ],
    tools=TOOLS
)

print(followup.output_text)
```

> **Why `input` array and not `previous_response_id`?** As of 2026-04-13, `previous_response_id` does not work through Poe (500 for Claude, data-retention error for GPT). Sending the full conversation via the `input` array is the reliable approach. This may be temporary. For how to do that without blowing prompt cache hits, see `cache.md`.

---

### tool_choice Options

| Option | Behavior |
|--------|----------|
| `"auto"` | Model decides (default) |
| `"required"` | Model must call at least one tool |
| `"none"` | Model must not call tools |

### Agentic Loop

Models can chain multiple tool calls for complex workflows:

```python
import json

def execute_tool(name, arguments):
    if name == "plus":
        return str(arguments["a"] + arguments["b"])
    elif name == "get_weather":
        return json.dumps({"temperature": 72, "condition": "sunny"})
    return "Unknown tool"

response = client.responses.create(
    model="GPT-5.4",
    input="What is 30000 + 30000 + 30000 + 4000 + 41? Treat that as a ZIP code and tell me the weather.",
    tools=TOOLS
)

max_iterations = 10
for i in range(max_iterations):
    func_calls = [o for o in response.output if o.type == "function_call"]

    if not func_calls:
        print(f"Final response: {response.output_text}")
        break

    tool_results = []
    for call in func_calls:
        print(f"Calling {call.name} with {call.arguments}")
        result = execute_tool(call.name, call.arguments)
        tool_results.append({"call_id": call.id, "output": result})

    # Send the full conversation history back via input array
    input_items = [{"role": "user", "content": original_input}]
    for call in func_calls:
        input_items.append(call)
        input_items.append({"type": "function_call_output", "call_id": call["id"], "output": execute_tool(call["name"], json.loads(call["arguments"]))})

    response = client.responses.create(
        model="GPT-5.4",
        input=input_items,
        tools=TOOLS
    )
```

---

## Response Format

### Non-Streaming

```json
{
  "id": "resp_abc123",
  "object": "response",
  "created_at": 1713123456,
  "model": "Claude-Sonnet-4.6",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "id": "msg_xyz789",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "The top 3 things to do in NYC are..."
        }
      ]
    }
  ],
  "output_text": "The top 3 things to do in NYC are...",
  "usage": {
    "input_tokens": 25,
    "output_tokens": 150,
    "total_tokens": 175
  }
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `completed` | Response finished successfully |
| `failed` | Response encountered an error |
| `in_progress` | Response is still being generated (streaming) |
| `incomplete` | Response requires tool results to continue |

### Output Text Shorthand

For simple text responses, `output_text` is a direct string:

```json
{
  "id": "resp_abc123",
  "output_text": "The capital of France is Paris.",
  "usage": {...}
}
```

---

## OpenAI SDK Compatibility

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.poe.com/v1",
    api_key=os.environ.get("POE_API_KEY")
)

response = client.responses.create(
    model="Claude-Sonnet-4.6",
    input="What is the capital of France?"
)
print(response.output_text)
```

### Node.js

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.poe.com/v1',
  apiKey: process.env.POE_API_KEY
});

const response = await client.responses.create({
  model: 'Claude-Sonnet-4.6',
  input: 'What is the capital of France?'
});
console.log(response.output_text);
```

---

## Migration: Chat Completions → Responses API

| Chat Completions | Responses API |
|-----------------|---------------|
| `client.chat.completions.create()` | `client.responses.create()` |
| `POST /v1/chat/completions` | `POST /v1/responses` |
| `messages: [{"role": "user", "content": "..."}]` | `input: "..."` |
| `response.choices[0].message.content` | `response.output_text` |
| `extra_body={"reasoning_effort": "high"}` | `reasoning={"effort": "high"}` (note: `extra_body` is being removed from Chat Completions — see `feature-flags.md`) |
| N/A | `tools=[{"type": "web_search_preview"}]` |
| N/A | `previous_response_id=response.id` (⚠️ broken on Poe as of 2026-04-13, use input array instead) |
| N/A | Multi-modal inputs (images) |

---

## Error Handling

Errors return standard format:

```json
{
  "error": {
    "code": 401,
    "type": "authentication_error",
    "message": "Invalid API key"
  }
}
```

| Status | Type | When |
|--------|------|------|
| 400 | `invalid_request_error` | Malformed JSON, missing fields |
| 401 | `authentication_error` | Bad/expired key |
| 402 | `insufficient_credits` | Balance ≤ 0 |
| 403 | `moderation_error` | Permission denied |
| 404 | `not_found_error` | Wrong endpoint/model |
| 429 | `rate_limit_error` | Rate limit exceeded (500 requests per minute) |
| 500 | `provider_error` | Server-side issue |

**Retry**: Respect `Retry-After` header on 429. Use exponential backoff starting at 250ms with jitter.
