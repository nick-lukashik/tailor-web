# Identity through the web proxy

How the person's identity reaches tailor-api. Built as below, except point 1: the site does not run a login flow of its own. Every site under the domain shares the one session cookie `__Secure-nl_session` that id-web sets (`docs/identity.md` of the org repo, README "Accounts"); this site reads it, refreshes it and sends its access token on.

## How identity travels

```
browser ──cookie──▶ web (Next.js) ──Authorization: Bearer <JWT>──▶ api ──JWKS──▶ id service
```

1. **Browser ↔ web: a session cookie.** id-web signs the person in and seals the tokens with AES-256-GCM under `SESSION_SECRET` into `__Secure-nl_session` (`Domain=<registered domain>`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`), the one cookie of every site under the domain. This site offers no "Sign in": the person signs in elsewhere on the platform. Tokens never reach browser JavaScript.
2. **Web: only people with the `tailor` role.** Every request but `/robots.txt`, `/health/*` and the build assets (`/_next/static`) needs a session whose access token carries `tailor` in its `roles` claim (granted in id-api). `src/proxy.ts` checks it before anything renders, after its refresh: no session, or no role → a bare 307 to the platform's landing (`HOME_URL`), no message, no sign-in offer; a session that does not carry the role is kept (it is the person's sign-in for the other sites). The `/api` route answers such calls 404 `NOT_FOUND` and never calls the API, so nothing tells there is one. The site reads the claim from the token's payload without checking the signature (`src/lib/session/claims.ts`): the token comes out of the cookie only id-web can seal with `SESSION_SECRET`, and the check only decides what this site shows. The lock is tailor-api, which verifies the token and the role on every call (403 `FORBIDDEN` without the role); the private layout asks its `GET /api/v1/me` and sends anyone it does not let in to the landing as well.
3. **Web → API: a server-side token.** The `/api` proxy and `serverApi` read the session and send its short-lived access token (an ES256 JWT of id-api, audience `nick-lukashik`) as `Authorization: Bearer …`. `src/proxy.ts` and the `/api` route refresh it when less than 60 s is left.
4. **API: validates the JWT through JWKS.** The API fetches the id service's JWKS (cached, refetched on an unknown `kid`) and checks the signature with an allow-listed algorithm, `iss`, `aud`, `exp` and `nbf`. The user is the token's `sub`; permissions come from its claims. The API trusts nothing else about the caller: no identity headers, no IP-based trust.
5. **API: owner checks.** Every owned row has a `user_id` (the `sub`); tailor-api also lets in only tokens with the `tailor` role (403 `FORBIDDEN`). Queries filter by it (`WHERE id = $1 AND owner_id = $sub`) rather than loading first and checking after, and someone else's resource answers 404, so its existence does not leak. Admin actions need an explicit permission claim.

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
- **CSRF on cookie-authenticated `/api` calls.** `SameSite=Lax`, plus an `Origin` (or `Sec-Fetch-Site`) check on `POST`, `PUT`, `PATCH` and `DELETE` in the `/api` route: another origin, another subdomain included, gets 403. Any call without a session with the `tailor` role gets 404 and never reaches the API.
- **Learning what the site is.** Without access every path is the same bare redirect to the landing and `/api` the same 404; `robots.txt` disallows everything and every page says `noindex`; the root metadata, the OG image and the manifest name only "Tailor".
- **A forged role.** A token with `tailor` added to its payload but a broken signature cannot get into the cookie (it is sealed with `SESSION_SECRET`), and if it did, the pages would render empty: tailor-api refuses it (401) and the layout sends the visitor away.
- **Token leaks.** Only the server can read tokens: sealed in the cookie, never in URLs, HTML or client bundles. Pino redacts `authorization` and `cookie` (`src/lib/logger.ts`).
- **Calling the API directly.** The API is reachable without the web (Traefik, other pods), so it validates every token itself: signature through JWKS, `iss`, `aud`, expiry, and algorithms from an allow-list (no `none`, no HMAC with a public key).
- **Insecure direct object references.** Owner filters in every query of the API; ids are UUIDs, but unguessable ids are not access control.
- **Key rotation and outage of the id service.** The JWKS cache survives short outages and refetches on an unknown `kid`; a token that cannot be verified is rejected (401), never accepted.
- **Abuse of the proxy itself.** Bodies are capped at 1 MiB and both the body and the upstream call have deadlines (README, "Request limits and time budgets"), so a slow or large request cannot tie up the web or the API.
