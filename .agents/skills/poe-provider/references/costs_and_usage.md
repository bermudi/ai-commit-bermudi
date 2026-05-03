# Poe API Costs & Usage

Monitor compute point balance and retrieve usage history. Poe bills in **compute points** (not tokens). Data is retained for 30 days.

---

## Get Current Point Balance

```
GET https://api.poe.com/usage/current_balance
```

```bash
curl "https://api.poe.com/usage/current_balance" \
  -H "Authorization: Bearer $POE_API_KEY"
```

**Response:**

```json
{
  "current_point_balance": 842500
}
```

| Field | Type | Description |
|-------|------|-------------|
| `current_point_balance` | integer | Current available points (plan + add-on) |

**Errors:**

| Status | Type | Meaning |
|--------|------|---------|
| 401 | `authentication_error` | Invalid API key |

---

## Get Usage History

```
GET https://api.poe.com/usage/points_history
```

```bash
# Latest 20 entries (default)
curl "https://api.poe.com/usage/points_history" \
  -H "Authorization: Bearer $POE_API_KEY"

# Up to 100 entries
curl "https://api.poe.com/usage/points_history?limit=100" \
  -H "Authorization: Bearer $POE_API_KEY"

# Paginate: pass last query_id as cursor
curl "https://api.poe.com/usage/points_history?limit=50&starting_after=abc123" \
  -H "Authorization: Bearer $POE_API_KEY"
```

**Parameters:**

| Name | Location | Type | Required | Description |
|------|----------|------|----------|-------------|
| `limit` | query | integer | No | Entries to return. Min 1, max 100, default 20. |
| `starting_after` | query | string | No | Pagination cursor — use `query_id` from the last entry of a previous response. |

**Response:**

```json
{
  "has_more": true,
  "length": 50,
  "data": [
    {
      "creation_time": 1713024000000000,
      "bot_name": "Claude-Sonnet-4.6",
      "query_id": "abc123",
      "usage_type": "API",
      "cost_points": 350
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `has_more` | boolean | More entries available for pagination |
| `length` | integer | Number of entries in this response |
| `data[].creation_time` | int64 | Unix timestamp in **microseconds** |
| `data[].bot_name` | string | Bot or model used |
| `data[].query_id` | string | Unique query identifier (pagination cursor) |
| `data[].usage_type` | string | `"API"` · `"Chat"` · `"Canvas App"` |
| `data[].cost_points` | integer | Points consumed by this query |

**Errors:**

| Status | Type | Meaning |
|--------|------|---------|
| 401 | `authentication_error` | Invalid API key |

---

## Pagination Pattern

Entries are ordered by creation time descending (newest first). Data is available for up to 30 days.

```typescript
async function getAllUsage(apiKey: string): Promise<UsageEntry[]> {
  const entries: UsageEntry[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("starting_after", cursor);

    const res = await fetch(`https://api.poe.com/usage/points_history?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page: { has_more: boolean; data: UsageEntry[] } = await res.json();

    entries.push(...page.data);
    cursor = page.data.at(-1)?.query_id;
    if (!page.has_more) break;
  } while (cursor);

  return entries;
}
```

---

## Practical Tips

- **Check balance before batch jobs** — avoids mid-run interruptions
- **Timestamps are microseconds** — divide by `1_000_000` to get seconds for `Date`
- **Group by `bot_name`** to identify which models are costing the most
- **Filter by `usage_type`** to separate API calls from chat/canvas usage in your own analytics
