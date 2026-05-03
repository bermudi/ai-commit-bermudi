# Poe API Error Reference

Poe API error codes and troubleshooting. Standard HTTP status codes and error handling patterns (retry with backoff, rate limiting) are assumed knowledge.

---

## Error Response Format

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "The 'model' field is required",
    "code": "MISSING_MODEL",
    "status": 400
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Error category |
| `message` | string | Human-readable description |
| `code` | string | Machine-readable error code |
| `status` | number | HTTP status code |

---

## Poe-Specific Errors

| Status | Type | Cause | Fix |
|--------|------|-------|-----|
| 400 | `invalid_request_error` | Malformed JSON, missing required fields | Validate request body |
| 401 | `authentication_error` | Invalid API key | Check `POE_API_KEY`, regenerate at poe.com/api |
| 402 | `insufficient_credits` | Point balance zero or negative | Add compute points |
| 403 | `permission_error` | Subscription doesn't cover this model | Upgrade or use eligible model |
| 404 | `not_found_error` | Model/endpoint not found | Verify model name with `poe-code models` |
| 429 | `rate_limit_error` | 500 rpm exceeded | Respect `Retry-After` header, implement backoff |
| 500 | `server_error` | Poe infrastructure issue | Retry with backoff |

---

## Streaming Errors

If an error occurs mid-stream, an SSE error event is sent before the stream closes:

```
event: error
data: {"type": "error", "error": {"type": "api_error", "message": "An error occurred"}}
```

---

## Debugging
