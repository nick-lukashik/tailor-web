# Identity through the web proxy

Not implemented yet: Tailor has no sign-in yet, so prod runs the proxy read-only (`API_READ_ONLY`). This is the model a future version follows, so the pieces that exist now (the `/api` proxy, `serverApi`, the logger) already fit it.

## How identity travels

```
browser ──cookie──▶ web (Next.js) ──Authorization: Bearer <JWT>──▶ api ──JWKS──▶ id service
```

1. **Browser ↔ web: a session cookie.** The web runs the login flow with the id service (OIDC authorization code with PKCE) on the server and seals the result, tokens included, into a session cookie with AES-256-GCM under a key only the server has. The sites that have accounts do this already: `__Host-id_session` on id-web and `__Host-site_session` on landing-web, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Tokens never reach browser JavaScript.
2. **Web → API: a server-side token.** The `/api` proxy and `serverApi` read the session and send its short-lived access token (a JWT issued by the id service, audience = that API) as `Authorization: Bearer …`. The web refreshes it server-side. A request without a session goes on anonymous: no `Authorization` at all.
3. **API: validates the JWT through JWKS.** The API fetches the id service's JWKS (cached, refetched on an unknown `kid`) and checks the signature with an allow-listed algorithm, `iss`, `aud`, `exp` and `nbf`. The user is the token's `sub`; permissions come from its claims. The API trusts nothing else about the caller: no identity headers, no IP-based trust.
4. **API: owner checks.** Every owned row has an `owner_id` (the `sub`). Queries filter by it (`WHERE id = $1 AND owner_id = $sub`) rather than loading first and checking after, and someone else's resource answers 404, so its existence does not leak. Admin actions need an explicit permission claim.

## What the proxy forwards

The proxy builds the upstream request from an allow-list (`src/lib/http/forwarded-headers.ts`); everything else the client sent is dropped.

| Header | Upstream |
|---|---|
| `accept`, `accept-language`, `content-type`, `user-agent` | copied |
| `x-request-id` | the client's value if well-formed, else a new id |
| `x-forwarded-for` | one address taken from `x-real-ip`, which Traefik's `real-ip` middleware sets (it overwrites the client's); the client's own `x-forwarded-*` are never forwarded |
| `authorization` | never from the client. Later: only the token from the server session |
| `cookie`, `x-user-*`, any other header | never |

The same allow-list applies to `serverApi` (server-side calls). Responses also pass through an allow-list: the API never sets cookies on the web's origin.

## Threat model

- **Forged identity headers.** A client sends `Authorization`, `X-User-Id` or `X-Forwarded-For` to pose as someone else or dodge rate limits. The proxy's allow-list drops them, and the API trusts only a JWT it verified itself.
- **Session theft through XSS.** The cookie is `HttpOnly` and its tokens are sealed, so a script can neither read it nor open it; the nonce CSP (`src/lib/security/csp.ts`) blocks injected scripts. Access tokens live for minutes and refresh tokens rotate.
- **CSRF on cookie-authenticated `/api` calls.** `SameSite=Lax`, plus an `Origin` (or `Sec-Fetch-Site`) check on `POST`, `PUT`, `PATCH` and `DELETE` in the proxy once sessions exist.
- **Token leaks.** Only the server can read tokens: sealed in the cookie, never in URLs, HTML or client bundles. Pino redacts `authorization` and `cookie` (`src/lib/logger.ts`).
- **Calling the API directly.** The API is reachable without the web (Traefik, other pods), so it validates every token itself: signature through JWKS, `iss`, `aud`, expiry, and algorithms from an allow-list (no `none`, no HMAC with a public key).
- **Insecure direct object references.** Owner filters in every query of the API; ids are UUIDs, but unguessable ids are not access control.
- **Key rotation and outage of the id service.** The JWKS cache survives short outages and refetches on an unknown `kid`; a token that cannot be verified is rejected (401), never accepted.
- **Abuse of the proxy itself.** Bodies are capped at 1 MiB and both the body and the upstream call have deadlines (README, "Request limits and time budgets"), so a slow or large request cannot tie up the web or the API.
