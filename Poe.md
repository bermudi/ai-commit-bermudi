The Poe API provides access to hundreds of AI models and bots through a single OpenAI-compatible endpoint. Switch between frontier models from all major labs, open-source models, and millions of community-created bots using the same familiar interface.

**Key benefits:**

-   Use your existing Poe subscription points with no additional setup
-   Access models across all modalities: text, image, video, and audio generation
-   OpenAI-compatible interface works with existing tools like [Cursor, Cline, Continue, and more](https://creator.poe.com/docs/external-applications/interface-configuration)
-   Single API key for hundreds of models instead of managing multiple provider keys

If you're already using the OpenAI libraries, you can use this API as a low-cost way to switch between calling OpenAI models and Poe hosted models/bots to compare output, cost, and scalability, without changing your existing code. If you aren't already using the OpenAI libraries, we recommend that you use our [Python SDK](https://creator.poe.com/docs/external-applications/external-application-guide).

[Using the OpenAI SDK](https://creator.poe.com/docs/external-applications/openai-compatible-api#using-the-openai-sdk)
---------------------------------------------------------------------------------------------------------------------

```
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "your_poe_api_key", // https://poe.com/api_key
    baseURL: "https://api.poe.com/v1",
});

const completion = await client.chat.completions.create({
    model: "Grok-4", // or other models (Claude-Sonnet-4, Gemini-2.5-Pro, GPT-Image-1, Veo-3..)
    messages: [
        {
            role: "system",
            content:
                "You are Grok, a highly intelligent, helpful AI assistant.",
        },
        {
            role: "user",
            content:
                "What is the meaning of life, the universe, and everything?",
        },
    ],
});

console.log(completion.choices[0].message.content);
```

[Options](https://creator.poe.com/docs/external-applications/openai-compatible-api#options)
-------------------------------------------------------------------------------------------

1.  **Poe Python Library** (✅ recommended)

    Install with `pip install fastapi-poe` for a native Python interface, better error handling, and ongoing feature support.

    → See the [External Application Guide](https://creator.poe.com/docs/external-applications/external-application-guide) to get started.

2.  **OpenAI-Compatible API** (for compatibility use cases only)

    Poe also supports the `/v1/chat/completions` format if you're migrating from OpenAI or need a REST-only setup.

    Base URL: `https://api.poe.com/v1`

> For new projects, use the Python SDK--it's the most reliable and flexible way to build on Poe.

[Known Issues & Limitations](https://creator.poe.com/docs/external-applications/openai-compatible-api#known-issues--limitations)
--------------------------------------------------------------------------------------------------------------------------------

### [Bot Availability](https://creator.poe.com/docs/external-applications/openai-compatible-api#bot-availability)

-   **Private bots are not currently supported** - Only public bots can be accessed through the API
-   **The App-Creator and Script-Bot-Creator bots are not available** via the OpenAI-compatible API endpoint (or via the Poe Python library)

### [Media Bot Recommendations](https://creator.poe.com/docs/external-applications/openai-compatible-api#media-bot-recommendations)

-   **Image, video, and audio bots** should be called with `stream=False` for optimal performance and reliability

### [Parameter Handling](https://creator.poe.com/docs/external-applications/openai-compatible-api#parameter-handling)

-   **Best-effort parameter passing** - We make our best attempts to pass down parameters where possible, but some model-specific parameters may not be fully supported across all bots
-   **Custom parameters (aspect, size, etc.)** - You can pass custom bot parameters through the OpenAI SDK using the `extra_body` parameter. For example: `extra_body={"aspect": "1280x720"}` for Sora-2. Alternatively, you can use the [Poe Python SDK](https://creator.poe.com/docs/external-applications/external-application-guide) with `fp.ProtocolMessage(parameters={...})`. See the [External Application Guide](https://creator.poe.com/docs/external-applications/external-application-guide#passing-custom-parameters) for details on available parameters.

### [Additional Considerations](https://creator.poe.com/docs/external-applications/openai-compatible-api#additional-considerations)

-   Some community bots may have varying response formats or capabilities compared to standard language models

### [API behavior](https://creator.poe.com/docs/external-applications/openai-compatible-api#api-behavior)

Here are the most substantial differences from using OpenAI:

-   **Structured outputs are not supported** - The `response_format` parameter with `type: "json_schema"` is not supported at this time.
-   The **`strict`** parameter for function calling is ignored, which means the tool use JSON is not guaranteed to follow the supplied schema.
-   Audio input is not supported; it will simply be ignored and stripped from input
-   Most unsupported fields are silently ignored rather than producing errors. These are all documented below.

[Detailed OpenAI Compatible API Support](https://creator.poe.com/docs/external-applications/openai-compatible-api#detailed-openai-compatible-api-support)
---------------------------------------------------------------------------------------------------------------------------------------------------------

### [Request fields](https://creator.poe.com/docs/external-applications/openai-compatible-api#request-fields)

| **Field** | **Support status** |
| --- | --- |
| **`model`** | Use Poe bot names (Note: Poe UI-specific system prompts are skipped) |
| **`max_tokens`** | Fully supported |
| **`max_completion_tokens`** | Fully supported |
| **`stream`** | Fully supported |
| **`stream_options`** | Fully supported |
| **`top_p`** | Fully supported |
| **`tools`** | Fully Supported |
| **`tool_choice`** | Fully Supported |
| **`parallel_tool_calls`** | Fully Supported |
| **`stop`** | All non-whitespace stop sequences work |
| **`temperature`** | Between 0 and 2 (inclusive). |
| **`n`** | Must be exactly 1 |
| **`logprobs`** | Fully supported |
| **`store`** | Ignored |
| **`metadata`** | Ignored |
| **`response_format`** | Ignored |
| **`prediction`** | Ignored |
| **`presence_penalty`** | Ignored |
| **`frequency_penalty`** | Ignored |
| **`seed`** | Ignored |
| **`service_tier`** | Ignored |
| **`audio`** | Ignored |
| **`logit_bias`** | Ignored |
| **`user`** | Ignored |
| **`modalities`** | Ignored |
| **`top_logprobs`** | Fully supported |
| **`reasoning_effort`** | Ignored (use `extra_body` instead) |
| **`extra_body`** | Fully supported - use to pass custom bot parameters like `reasoning_effort`, `thinking_budget`, etc. |

### [Response fields](https://creator.poe.com/docs/external-applications/openai-compatible-api#response-fields)

| **Field** | **Support status** |
| --- | --- |
| **`id`** | Fully supported |
| **`choices[]`** | Will always have a length of 1 |
| **`choices[].finish_reason`** | Fully supported |
| **`choices[].index`** | Fully supported |
| **`choices[].message.role`** | Fully supported |
| **`choices[].message.content`** | Fully supported |
| **`choices[].message.tool_calls`** | Fully supported |
| **`object`** | Fully supported |
| **`created`** | Fully supported |
| **`model`** | Fully supported |
| **`finish_reason`** | Fully supported |
| **`content`** | Fully supported |
| **`usage.completion_tokens`** | Fully supported |
| **`usage.prompt_tokens`** | Fully supported |
| **`usage.total_tokens`** | Fully supported |
| **`usage.completion_tokens_details`** | Always empty |
| **`usage.prompt_tokens_details`** | Always empty |
| **`choices[].message.refusal`** | Always empty |
| **`choices[].message.audio`** | Always empty |
| **`logprobs`** | Always empty |
| **`service_tier`** | Always empty |
| **`system_fingerprint`** | Always empty |

### [Using Custom Parameters with `extra_body`](https://creator.poe.com/docs/external-applications/openai-compatible-api#using-custom-parameters-with-extra_body)

You can pass custom bot-specific parameters using the `extra_body` field. This allows you to control features like reasoning effort, thinking budget, aspect ratios for image generation, and other model-specific settings.

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

// Example: Using aspect ratio and quality with image generation models
const response3 = await client.chat.completions.create({
    model: "GPT-Image-1",
    messages: [{ role: "user", content: "A serene landscape with mountains" }],
    extra_body: {
        aspect: "3:2",    // Options: "1:1", "3:2", "2:3", "auto"
        quality: "high"   // Options: "low", "medium", "high"
    },
    stream: false  // Recommended for image generation
});
```

```
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

// Example: Using web search and thinking level with Gemini models
const response = await client.chat.completions.create({
    model: "Gemini-3-Pro",
    messages: [{ role: "user", content: "What are the latest developments in quantum computing?" }],
    extra_body: {
        web_search: true,
        thinking_level: "high"
    }
});
```

### [Error message compatibility](https://creator.poe.com/docs/external-applications/openai-compatible-api#error-message-compatibility)

The compatibility layer maintains consistent error formats with the OpenAI API. However, the detailed error messages may not be equivalent. We recommend only using the error messages for logging and debugging.

All errors return:

```
{
  "error": {
    "code": 401,
    "type": "authentication_error",
    "message": "Invalid API key",
    "metadata": {...}
  }
}
```

| HTTP / `code` | `type` | When it happens |
| --- | --- | --- |
| **400** | `invalid_request_error` | malformed JSON, missing fields |
| **401** | `authentication_error` | bad/expired key |
| **402** | `insufficient_credits` | balance ≤ 0 |
| **403** | `moderation_error` | permission denied or authorization issues |
| **404** | `not_found_error` | wrong endpoint / model |
| **408** | `timeout_error` | model didn't start in a reasonable time |
| **413** | `request_too_large` | tokens > context window |
| **429** | `rate_limit_error` | rpm/tpm cap hit |
| **500** | `provider_error` | provider-side issues, or invalid requests |
| **502** | `upstream_error` | model backend not working |
| **529** | `overloaded_error` | transient traffic spike |

**Retry tips**

-   Respect `Retry-After` header on 429/503.
-   Exponential back‑off (starting at 250 ms) plus jitter works well.
-   Idempotency: resubmit the exact same payload to safely retry.

### [Header compatibility](https://creator.poe.com/docs/external-applications/openai-compatible-api#header-compatibility)

While the OpenAI SDK automatically manages headers, here is the complete list of headers supported by Poe's API for developers who need to work with them directly.

Response Headers:

| **Header** | **Definition** | **Support Status** |
| --- | --- | --- |
| **`openai-organization`** | OpenAI org | Unsupported |
| **`openai-processing-ms`** | Time taken processing your API request | Supported |
| **`openai-version`** | REST API version (**`2020-10-01`)** | Supported |
| **`x-request-id`** | Unique identifier for this API request (troubleshooting) | Supported |

**Rate Limit Headers**

Our rate limit is 500 requests per minute (rpm). We support request-based rate limit headers but do not support token-based rate limiting:

**Supported (Request-based):**

-   `x-ratelimit-limit-requests` - Maximum requests allowed per time window (500)
-   `x-ratelimit-remaining-requests` - Remaining requests in current time window
-   `x-ratelimit-reset-requests` - Seconds until the rate limit resets

**Not Supported (Token-based):**

-   `x-ratelimit-limit-tokens` - Not applicable (Poe does not use token-based rate limiting)
-   `x-ratelimit-remaining-tokens` - Not applicable
-   `x-ratelimit-reset-tokens` - Not applicable

[Getting Started](https://creator.poe.com/docs/external-applications/openai-compatible-api#getting-started)
-----------------------------------------------------------------------------------------------------------

```
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

const completion = await client.chat.completions.create({
    model: "Claude-Sonnet-4", // or other models (Gemini-2.5-Pro, GPT-Image-1, Veo-3, Grok-4..)
    messages: [
        {
            role: "user",
            content: "What are the top 3 things to do in New York?",
        },
    ],
});

console.log(completion.choices[0].message.content);
```

[Streaming](https://creator.poe.com/docs/external-applications/openai-compatible-api#streaming)
-----------------------------------------------------------------------------------------------

You can also use OpenAI's streaming capabilities to stream back your response:

```
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

const stream = await client.chat.completions.create({
    model: "Gemini-2.5-Pro", // or other models (Claude-Sonnet-4, GPT-Image-1, Veo-3, Llama-3.1-405B..)
    messages: [
        {
            role: "system",
            content: "You are a travel agent. Be descriptive and helpful.",
        },
        {
            role: "user",
            content: "Tell me about San Francisco",
        },
    ],
    stream: true,
});

for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

[File Inputs](https://creator.poe.com/docs/external-applications/openai-compatible-api#file-inputs)
---------------------------------------------------------------------------------------------------

You can also pass in files using base64-encoded data URLs:

```
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

const base64_pdf = fs.readFileSync(path.resolve("test_pdf.pdf"), { encoding: "base64" });
const base64_image = fs.readFileSync(path.resolve("test_image.jpeg"), { encoding: "base64" });
const base64_audio = fs.readFileSync(path.resolve("test_audio.mp3"), { encoding: "base64" });

const stream = await client.chat.completions.create({
    model: "Claude-Sonnet-4", // or other models
    messages: [
        {
            role: "user",
            content: [
                {
                    "type": "text",
                    "text": "Please describe these attachments."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": `data:image/jpg;base64,${base64_image}`
                    }
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "test_guide.pdf",
                        "file_data": `data:application/pdf;base64,${base64_pdf}`
                    }
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "test_audio.mp3",
                        "file_data": `data:audio/mp3;base64,${base64_audio}`
                    }
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "test_video.mp3",
                        "file_data": `data:video/mp4;base64,${base64_video}`
                    }
                }
            ]
        },
    ],
    stream: true,
});

for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0].delta.content || "");
}
```

Additionally, Poe accepts image input files that are hosted on publicly accessible URLs.

```
import { OpenAI } from "openai";

const client = new OpenAI({
    apiKey: process.env.POE_API_KEY,
    baseURL: "https://api.poe.com/v1",
});

const stream = await client.chat.completions.create({
    model: "GPT-4o", // or other models
    messages: [
        {
            role: "user",
            content: [
                {
                    "type": "text",
                    "text": "Please describe these attachments."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://psc2.cf2.poecdn.net/assets/_next/static/media/poeFullMultibot.aa56caf5.svg"
                    }
                }
            ]
        },
    ],
    stream: true,
});

for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0].delta.content || "");
}
```

[Migration checklist (OpenAI → Poe in 60 s)](https://creator.poe.com/docs/external-applications/openai-compatible-api#migration-checklist-openai--poe-in-60-s)
--------------------------------------------------------------------------------------------------------------------------------------------------------------

1.  Swap base URL - `https://api.openai.com/v1` → `https://api.poe.com/v1`
2.  Replace key env var - `OPENAI_API_KEY` → `POE_API_KEY`
3.  Select the model/bot you want to use e.g. `Claude-Opus-4.1`
4.  Delete any `n > 1`, audio, or `parallel_tool_calls` params.
5.  Run tests - output should match except for intentional gaps above.

[Pricing & Availability](https://creator.poe.com/docs/external-applications/openai-compatible-api#pricing--availability)
------------------------------------------------------------------------------------------------------------------------

All Poe subscribers can use their existing subscription points with the API at no additional cost.

This means you can seamlessly transition between the web interface and API without worrying about separate billing structures or additional fees. Your regular monthly point allocation works exactly the same way whether you're chatting directly on Poe or accessing bots programmatically through the API.

If your Poe subscription is not enough, you can now [purchase add-on points](https://poe.com/api_key) to get as much access as your application requires. Our intent in pricing these points is to charge the same amount for model access that underlying model providers charge. Any add-on points you purchase can be used with any model or bot on Poe and work across both the API and Poe chat on web, iOS, Android, Mac, and Windows.

[Support](https://creator.poe.com/docs/external-applications/openai-compatible-api#support)
-------------------------------------------------------------------------------------------

Feel free to [reach out to support](mailto:developers@poe.com) if you come across some unexpected behavior when using our API or have suggestions for future improvements.