# Poe Authentication Reference

---

## API Key Authentication

### Getting Your API Key

1. Log into [poe.com](https://poe.com)
2. Navigate to [poe.com/api](https://poe.com/api)
3. Click "Create API Key"
4. Copy the key (starts with `poe-`)

### Environment Setup

```bash
export POE_API_KEY=poe-xxxxx-your-key-here
```

### Verifying Authentication

```bash
poe-code auth status
```

---

## OAuth PKCE Flow

For user-facing apps where users authenticate with their own Poe accounts.

### 1. Create Authorization URL

```typescript
import crypto from 'crypto';

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const codeVerifier = generateCodeVerifier();
const authUrl = new URL('https://poe.com/oauth/authorize');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', 'YOUR_CLIENT_ID');
authUrl.searchParams.set('redirect_uri', 'https://yourapp.com/callback');
authUrl.searchParams.set('code_challenge', generateCodeChallenge(codeVerifier));
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('scope', 'read');

session.codeVerifier = codeVerifier;
res.redirect(authUrl.toString());
```

### 2. Exchange Code for Token

```typescript
const response = await fetch('https://api.poe.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    client_id: 'YOUR_CLIENT_ID',
    code: req.query.code,
    redirect_uri: 'https://yourapp.com/callback',
    code_verifier: session.codeVerifier
  })
});
```

### 3. Refresh Token

```typescript
const response = await fetch('https://api.poe.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'refresh_token',
    client_id: 'YOUR_CLIENT_ID',
    refresh_token: storedRefreshToken
  })
});
```

---

## Poe-Specific Gotchas

| Mistake | Correct |
|---------|---------|
| Env var `OPENAI_API_KEY` | `POE_API_KEY` |
| Key prefix `sk-...` | `poe-xxxxx-...` |
| Base URL `api.openai.com` | `api.poe.com/v1` |
| Auth header varies | See API reference for correct header per endpoint |
