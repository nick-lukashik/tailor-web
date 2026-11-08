# Identity through the web proxy

How the person's identity reaches tailor-api. Built as below, except point 1: the site does not run a login flow of its own. Every site under the domain shares the one session cookie `__Secure-nl_session` that id-web sets (`docs/identity.md` of the org repo, README "Accounts"); this site reads it, refreshes it and sends its access token on.

## How identity travels

```
browser ──cookie──▶ web (Next.js) ──Authorization: Bearer <JWT>──▶ api ──JWKS──▶ id service
```

1. **Browser ↔ web: a session cookie.** id-web signs the person in and seals the tokens with AES-256-GCM under `SESSION_SECRET` into `__Secure-nl_session` (`Domain=<registered domain>`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`), the one cookie of every site under the domain. "Sign in" here is a link to `${ID_URL}/login?continue=<page>`. Tokens never reach browser JavaScript.
2. **Web → API: a server-side token.** The `/api` proxy and `serverApi` read the session and send its short-lived access token (an ES256 JWT of id-api, audience `nick-lukashik`) as `Authorization: Bearer …`. `src/proxy.ts` and the `/api` route refresh it when less than 60 s is left. A read without a session goes on anonymous (no `Authorization`, tailor-api answers 401); a write without one is refused here.
3. **API: validates the JWT through JWKS.** The API fetches the id service's JWKS (cached, refetched on an unknown `kid`) and checks the signature with an allow-listed algorithm, `iss`, `aud`, `exp` and `nbf`. The user is the token's `sub`; permissions come from its claims. The API trusts nothing else about the caller: no identity headers, no IP-based trust.
4. **API: owner checks.** Every owned row has a `user_id` (the `sub`); tailor-api also lets in only the users of `TAILOR_USERS` (403 `NOT_INVITED`). Queries filter by it (`WHERE id = $1 AND owner_id = $sub`) rather than loading first and checking after, and someone else's resource answers 404, so its existence does not leak. Admin actions need an explicit permission claim.

## What the proxy forwards

The proxy builds the upstream request from an allow-list (`src/lib/http/forwarded-headers.ts`); everything else the client sent is dropped.

| Header | Upstream |
|---|---|
| `accept`, `accept-language`, `content-type`, `user-agent` | copied |
| `x-request-id` | the client's value if well-formed, else a new id |
| `x-forwarded-for` | one address taken from `x-real-ip`, which Traefik's `real-ip` middleware sets (it overwrites the client's); the client's own `x-forwarded-*` are never forwarded |
| `authorization` | never from the client: only `Bearer <access token>` from the session cookie, set by the `/api` route and `serverApi` |
| `cookie`, `x-user-*`, any other header | never |

The same allow-list applies to `serverApi` (server-side calls). Responses also pass through an allow-list: the API never sets cookies on the web's origin.

## Threat model

- **Forged identity headers.** A client sends `Authorization`, `X-User-Id` or `X-Forwarded-For` to pose as someone else or dodge rate limits. The proxy's allow-list drops them, and the API trusts only a JWT it verified itself.
- **Session theft through XSS.** The cookie is `HttpOnly` and its tokens are sealed, so a script can neither read it nor open it; the nonce CSP (`src/lib/security/csp.ts`) blocks injected scripts. Access tokens live for minutes and refresh tokens rotate.
- **CSRF on cookie-authenticated `/api` calls.** `SameSite=Lax`, plus an `Origin` (or `Sec-Fetch-Site`) check on `POST`, `PUT`, `PATCH` and `DELETE` in the `/api` route: another origin, another subdomain included, gets 403. A write without a session gets 401 and never reaches the API.
- **Token leaks.** Only the server can read tokens: sealed in the cookie, never in URLs, HTML or client bundles. Pino redacts `authorization` and `cookie` (`src/lib/logger.ts`).
- **Calling the API directly.** The API is reachable without the web (Traefik, other pods), so it validates every token itself: signature through JWKS, `iss`, `aud`, expiry, and algorithms from an allow-list (no `none`, no HMAC with a public key).
- **Insecure direct object references.** Owner filters in every query of the API; ids are UUIDs, but unguessable ids are not access control.
- **Key rotation and outage of the id service.** The JWKS cache survives short outages and refetches on an unknown `kid`; a token that cannot be verified is rejected (401), never accepted.
- **Abuse of the proxy itself.** Bodies are capped at 1 MiB and both the body and the upstream call have deadlines (README, "Request limits and time budgets"), so a slow or large request cannot tie up the web or the API.
