# Poe Chat Completions API Reference

OpenAI-compatible Chat Completions endpoint for drop-in replacement with existing code.

## ✅ Tested & Confirmed (2026-04-13)

All core features were tested against both `Claude-Haiku-4.5` and `gpt-5.4-mini`. This endpoint has **fewer platform gaps than the Responses API** through Poe right now:

| Feature | Claude-Haiku-4.5 | gpt-5.4-mini |
|---------|:---:|:---:|
| Basic text generation | ✅ | ✅ |
| System messages (`role: "system"`) | ✅ | ✅ |
| Tool calling | ✅ | ✅ |
| Parallel tool calls | ✅ | ✅ |
| Agentic loop (tool result roundtrip) | ✅ | ✅ |
| Multi-turn (message history) | ✅ | ✅ |
| Streaming (SSE) | ✅ | ✅ |
| Image input (base64 data URI) | ✅ | ✅ |
| Strict mode header (`poe-feature: chat-completions-strict`) | ✅ | ✅ |
| `temperature=0` deterministic | ✅ | ✅ |
| `max_tokens` enforcement | ✅ | ⚠️ returned empty content in test |

**Contrast with Responses API:** the Responses API's `instructions` and `previous_response_id` fields are both broken through Poe (as of 2026-04-13). Chat Completions has no equivalent gaps — `role: "system"` and multi-turn via message history both work. See `responses-api.md` for details on those gaps.

---

## Endpoint

```
POST https://api.poe.com/v1/chat/completions
```

**Note**: This is similar to OpenAI's Chat Completions API but routes through Poe's infrastructure.

## Breaking Change: Strict Validation Rollout

Poe is moving `/v1/chat/completions` from a permissive compatibility layer to **strict OpenAI-compatible request validation**.

What this means in practice:
- Non-standard fields that previously slipped through, such as `extra_body`, may fail in strict mode
- Older Poe-side parameter transformations and renamed compatibility params are being removed to make the endpoint behave more like the first-party service
- If you need provider-native knobs such as reasoning controls, prefer `/v1/responses` or the provider's first-party API instead of forcing them through Chat Completions
- Poe announced the temporary legacy fallback is scheduled to end on **2026-04-24**

### Feature Flag Headers

During rollout, control behavior with the `poe-feature` request header:

- `poe-feature: chat-completions-strict` — opt into strict validation early
- `poe-feature: chat-completions-legacy` — temporary fallback during the grace period
- Multiple feature flags may be comma-separated
- Unknown feature flags are ignored

Every response includes `x-poe-feature-active` so you can confirm which mode actually served the request.

### Strict-Mode Test Request

```bash
curl -X POST "https://api.poe.com/v1/chat/completions" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "poe-feature: chat-completions-strict" \
  -d '{
    "model": "Claude-Sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## Authentication

```bash
curl -X POST "https://api.poe.com/v1/chat/completions" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json"
```

---

## Request Format

### Minimal Request

```json
{
  "model": "claude-3-5-sonnet",
  "messages": [
    {"role": "user", "content": "Hello"}
  ]
}
```

### Full Request

```json
{
  "model": "claude-3-5-sonnet",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "Explain quantum computing"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "top_p": 1.0,
  "stream": false,
  "stop": null
}
```

> **Strict-mode rule:** Only send fields defined by the OpenAI Chat Completions schema. Do not rely on `extra_body` or other Poe compatibility transforms on this endpoint.

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | Required | Model identifier |
| `messages` | array | Required | Conversation messages |
| `temperature` | float | 1.0 | Sampling temperature |
| `max_tokens` | int | Model default | Max response tokens |
| `max_completion_tokens` | int | null | Maximum number of completion tokens to generate |
| `top_p` | float | 1.0 | Nucleus sampling |
| `stream` | boolean | false | Enable streaming |
| `stream_options` | object | null | Options for streaming |
| `stop` | string \| string[] | null | Up to 4 sequences where the API will stop generating |
| `tools` | array | null | Available functions |
| `tool_choice` | string | auto | Controls which function is called |
| `parallel_tool_calls` | boolean | null | Enable parallel function calling |
| `n` | int | 1 | Number of completion choices (must be 1) |

### Temperature vs Top-P

Use **either** `temperature` **or** `top_p`, not both. Using both can lead to unexpected behavior.

- `temperature`: Direct sampling control (0.0 = deterministic, 2.0 = very random)
- `top_p`: Nucleus sampling (0.1 = top 10% probability mass)

---

## Message Format

### Standard Roles

```json
[
  {"role": "system", "content": "You are a helpful assistant"},
  {"role": "user", "content": "What is 2+2?"},
  {"role": "assistant", "content": "2+2 equals 4."},
  {"role": "user", "content": "Thanks!"}
]
```

### Message Fields

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | Message author role |
| `content` | string \| array | Message content |
| `name` | string | Name of the message author |
| `tool_calls` | array | Tool calls generated by the model |
| `tool_call_id` | string | Tool call this message responds to |

### Roles Reference

| Role | Description |
|------|-------------|
| `system` | System instructions (precedes user). Note: Poe UI-specific system prompts are skipped |
| `user` | Human messages |
| `assistant` | AI responses |
| `tool` | Tool execution results |

### Multimodal Content

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "What is in this image?"},
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/photo.jpg",
        "detail": "auto"
      }
    }
  ]
}
```

**Image detail options:**
- `auto`: Model decides
- `low`: Lower resolution (faster, cheaper)
- `high`: High resolution (slower, more expensive)

---

## Response Format

### Non-Streaming

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "claude-3-5-sonnet",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Response text..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 150,
    "total_tokens": 200
  }
}
```

### Finish Reasons

| Reason | Meaning |
|--------|-------------|
| `stop` | Natural stopping point |
| `length` | Hit `max_tokens` limit |
| `content_filter` | Content filtered |
| `tool_calls` | Tool execution needed |

---

## Streaming

### Request

```bash
curl -X POST "https://api.poe.com/v1/chat/completions" \
  -H "Authorization: Bearer $POE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
```

### Streaming Response

Server-Sent Events format:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":123,"model":"claude-3-5-sonnet","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":123,"model":"claude-3-5-sonnet","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: [DONE]
```

### Client Implementation

```typescript
async function* streamChat(messages: any[], model: string) {
  const response = await fetch('https://api.poe.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.POE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages, stream: true })
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

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
```

---

## Tool Calling

Tool calling enables LLMs to interact with external functions. The model suggests tool calls with specific arguments, your client executes them, and returns results to continue the conversation.

> **Tool calling works** — tested with both Claude and GPT models through Poe. The model returns `function` tool calls with correct arguments, supports parallel calls, and correctly incorporates tool results when you send them back. Note that tool support still varies across *all* Poe models (not every model supports tools); the major ones (Claude, GPT) do.

---

### Defining Tools

```python
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "plus",
            "description": "Add two integers together",
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {"type": "integer", "description": "First integer"},
                    "b": {"type": "integer", "description": "Second integer"}
                },
                "required": ["a", "b"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City and state, e.g. San Francisco, CA"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"]
            }
        }
    }
]
```

---

### Tool Calling Flow

#### Step 1: Request with Tools

```python
messages = [
    {"role": "user", "content": "What is 1999 + 2036? Also, what's the weather like in New York?"}
]

response = client.chat.completions.create(
    model="Claude-Sonnet-4.6",
    messages=messages,
    tools=TOOLS,
    tool_choice="auto"
)

print(response.choices[0].message.tool_calls)
```

**Example output:**

```python
[
  ChatCompletionMessageToolCall(
    id='call_abc123',
    function=Function(arguments='{"a": 1999, "b": 2036}', name='plus'),
    type='function'
  ),
  ChatCompletionMessageToolCall(
    id='call_def456',
    function=Function(arguments='{"location": "New York"}', name='get_weather'),
    type='function'
  )
]
```

#### Step 2: Execute Tools (Client)

```python
import json

tool_messages = []

for tool_call in response.choices[0].message.tool_calls:
    if tool_call.function.name == "plus":
        args = json.loads(tool_call.function.arguments)
        result = args["a"] + args["b"]  # 4035
        tool_messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": str(result)
        })

    elif tool_call.function.name == "get_weather":
        args = json.loads(tool_call.function.arguments)
        result = {"temperature": 72, "unit": "fahrenheit", "condition": "sunny"}
        tool_messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result)
        })
```

#### Step 3: Continue Conversation with Tool Results

```python
messages.append(response.choices[0].message)
messages.extend(tool_messages)

final_response = client.chat.completions.create(
    model="Claude-Sonnet-4.6",
    messages=messages,
    tools=TOOLS
)

print(final_response.choices[0].message.content)
```

**Example output:**

```
1999 + 2036 = 4035.

Current weather in New York, NY: sunny, around 72°F.
```

---

### tool_choice Options

Control how the model uses tools:

| Option | Behavior |
|--------|----------|
| `"auto"` | Model decides (default) |
| `"none"` | Model must not call tools |
| `{"type": "function", "function": {"name": "get_weather"}}` | Force a specific tool |

#### Force a Specific Tool

```python
response = client.chat.completions.create(
    model="Claude-Sonnet-4.6",
    messages=[{"role": "user", "content": "What's 42 plus 58?"}],
    tools=TOOLS,
    tool_choice={"type": "function", "function": {"name": "plus"}}
)

print(response.choices[0].message.tool_calls)
```

> **Note**: The `allowed_tools` option (`{"type": "allowed_tools", "allowed_tools": {...}}`) is not supported by most Poe models, even though it's in the OpenAI spec. Only specific models like `o3-mini` may support it.

---

### Agentic Loop

Models can chain multiple tool calls for complex workflows:

```python
import json

def execute_tool_call(tool_call):
    function_name = tool_call.function.name
    arguments = json.loads(tool_call.function.arguments)

    if function_name == "plus":
        return str(arguments["a"] + arguments["b"])
    elif function_name == "get_weather":
        return json.dumps({"temperature": 72, "condition": "sunny"})
    return "Tool not found"

messages = [
    {"role": "user", "content": "What is 30000 + 30000 + 30000 + 4000 + 41? Treat that number as a ZIP code and tell me the weather there."}
]

max_iterations = 10
for i in range(max_iterations):
    response = client.chat.completions.create(
        model="GPT-5.4",
        messages=messages,
        tools=TOOLS
    )

    assistant_message = response.choices[0].message

    if not assistant_message.tool_calls:
        print(f"Final response: {assistant_message.content}")
        break

    messages.append(assistant_message)

    for tool_call in assistant_message.tool_calls:
        print(f"Calling {tool_call.function.name} with {tool_call.function.arguments}")
        result = execute_tool_call(tool_call)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result
        })
```

**Example output:**

```
Calling plus with {"a": 30000, "b": 30000}
Calling plus with {"a": 60000, "b": 30000}
Calling plus with {"a": 90000, "b": 4041}
Calling get_weather with {"location": "94041", "unit": "fahrenheit"}
Final response: The sum is 94,041. Current weather in ZIP 94041: 72°F and sunny.
```

---

### Tool Response Format

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "index": 0,
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\": \"San Francisco\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

### Continuing with Tool Results

```json
{
  "model": "Claude-Sonnet-4.6",
  "messages": [
    {"role": "user", "content": "What's the weather in San Francisco?"},
    {"role": "assistant", "tool_calls": [{"id": "call_abc123", "function": {"name": "get_weather", "arguments": "{\"location\": \"San Francisco\"}"}}]},
    {"role": "tool", "tool_call_id": "call_abc123", "content": "{\"temperature\": 22, \"conditions\": \"Sunny\"}"}
  ]
}
```

---

## Migration Checklist for Strict Mode

1. **Check model endpoint support first**
   - Call `GET https://api.poe.com/v1/models`
   - Confirm your model includes `/v1/chat/completions` in `supported_endpoints`
2. **Remove non-standard request fields**
   - Especially `extra_body`
   - Also remove any older Poe-specific aliases or renamed provider params
3. **Test with strict mode during rollout**
   - Send `poe-feature: chat-completions-strict`
4. **Confirm the active mode**
   - Inspect `x-poe-feature-active` on the response
5. **Use legacy mode only as a short-lived fallback**
   - `poe-feature: chat-completions-legacy`
   - Do not treat this as a permanent fix
6. **Prefer `/v1/responses` when you need provider-native features**
   - Reasoning controls, structured outputs, built-in web search, and similar features fit better there

---

## OpenAI SDK Compatibility

### Node.js

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.poe.com/v1',
  apiKey: process.env.POE_API_KEY
});

// Use exactly like OpenAI
const chat = await client.chat.completions.create({
  model: 'claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Hello' }]
});
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.poe.com/v1",
    api_key=os.environ.get("POE_API_KEY")
)

response = client.chat.completions.create(
    model="claude-3-5-sonnet",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### LangChain

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  model: 'claude-3-5-sonnet',
  openAIApiKey: process.env.POE_API_KEY,
  configuration: {
    basePath: 'https://api.poe.com/v1'
  }
});
```

---

## Model Mapping

| OpenAI Model | Poe Equivalent |
|--------------|---------------|
| `gpt-4` | `claude-3-5-sonnet` or `claude-3-opus` |
| `gpt-3.5-turbo` | `claude-3-haiku` or `claude-3-sonnet` |
| `gpt-4-turbo` | `claude-3-5-sonnet` |
| `gpt-4o` | `claude-3-5-sonnet` |

**Note**: Model names on Poe may differ. Use `poe-code models` to find exact identifiers.

---

## Error Handling

### Common Errors

| Status | Error | Solution |
|--------|-------|----------|
| 400 | Bad request | Check JSON format or missing required fields |
| 401 | Invalid key | Verify `POE_API_KEY` |
| 402 | Insufficient credits | Point balance is zero or negative |
| 403 | Forbidden | Check subscription tier |
| 404 | Model not found | Use correct model name |
| 429 | Rate limited | Implement backoff (500 requests/minute) |
| 500 | Server error | Retry later |

**Important notes:**
- Private bots are not currently supported
- Image/video/audio bots should use `stream: false` for best results
- Custom parameters require the Poe Python SDK

### Retry Implementation

```typescript
async function chatWithRetry(messages: any[], model: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('https://api.poe.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.POE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages })
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await sleep(Math.pow(2, i) * 1000);
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```
