# tailor-web

The site of Tailor on `tailor.<domain>`: a CV and a cover letter for each vacancy, and every application on one board. Its backend is [`tailor-api`](https://github.com/nick-lukashik/tailor-api) (OpenAPI copy in `e2e/mock-api/openapi.json`; the bundled mock serves the same contract for development and tests).

Created from [`next-starter`](https://github.com/nick-lukashik/next-starter) (`.template-version`) plus the API part of [`next-example`](https://github.com/nick-lukashik/next-example) (the `/api` proxy, TanStack Query, the typed client, toasts). Now: sign-in through `id`, the home page, the person's applications (list and page, with a link to the demo CV on `cv.<domain>`) and their profile as a JSON editor. Every page but the home page needs a signed-in person whom tailor-api lets in (D-112). The pipeline and the forms come with the logic.

## What is inside

- Next.js 16.4 (App Router, `output: 'standalone'`, React Compiler, typed routes), React 19.3, TypeScript 7 strict, Node 26, pnpm 12.
- TanStack Query 5: server prefetch and `HydrationBoundary`, cursor-based infinite list.
- Typed API client: types from OpenAPI (`openapi-typescript`), `ApiError` for the error contract, query key factory.
- SEO: title/description in both languages, canonical, hreflang, Open Graph and Twitter, `robots.txt`, `sitemap.xml`, OG image, icons, manifest, JSON-LD.
- Security: per-request nonce CSP (no `unsafe-inline` for scripts or styles in production), security headers, `/api` proxy on the same origin with a 1 MiB body cap, deadlines and a request header allow-list ([identity model](docs/auth.md)).
- EN and RU without a locale in the URL.
- UI: shadcn/ui (Radix base, neutral palette, one light theme): Button, Input, Textarea, Label, Field, Card, Skeleton, Sonner toasts. AA contrast, checked by axe.
- Env through Zod, Pino JSON logs with request id, `/health/live` and `/health/ready` probes, 404 and error pages.
- Biome, Vitest, Playwright with axe, Dockerfile, CI, Renovate.
- Agent rules: [AGENTS.md](AGENTS.md) and [.claude/rules/](.claude/rules/).

## Getting started

Requires Node 26 and pnpm 12.

```bash
pnpm install
pnpm env:local          # .env.local from .env.example
pnpm mock:api           # terminal 1: mock API on :4000 (45 applications in memory)
pnpm dev                # terminal 2: http://localhost:3000
```

To use the real backend, run `tailor-api` (its README, "Getting started") on `:4000` instead of the mock. Production build locally: `pnpm build && pnpm start` (the same `server.js` as in the container).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | dev server on `:3000` |
| `pnpm build` / `pnpm start` | standalone build and running it |
| `pnpm verify` | Biome + `next typegen && tsc` + Vitest + build |
| `pnpm test:e2e` | Playwright against the build and the mock API (run `pnpm build` first; browser: `pnpm exec playwright install chromium`) |
| `pnpm test:e2e:real` | the applications specs against a real tailor-api at `E2E_API_URL` ([below](#end-to-end-against-a-real-api)) |
| `pnpm test` | unit tests |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm api:types [source]` | regenerate `src/lib/api/schema.d.ts`; source is the argument, else `OPENAPI_URL`, else `e2e/mock-api/openapi.json`; `-- --check` fails if the file is stale |
| `pnpm mock:api` | mock API (`PORT`, `MOCK_DELAY_MS`) |
| `pnpm env:local` | create or update `.env.local` |
| `pnpm exec shadcn add <name>` | add a shadcn/ui component (CLI pinned in `devDependencies`) |

## Where things are

| What | Where |
|---|---|
| QueryClient: browser singleton, one per request on the server, devtools in dev only | `src/lib/query/`, `src/app/providers.tsx` |
| API client, errors, keys and query options | `src/lib/api/` (`client.ts`, `errors.ts`, `applications.ts`, `types.ts`) |
| Applications: server prefetch + `HydrationBoundary`, infinite list | `src/app/(private)/applications/(list)/page.tsx`, `src/app/(private)/applications/_components/applications-list.tsx` |
| Application page: `generateMetadata`, `notFound()`, the CV link of the application (`CV_URL`) | `src/app/(private)/applications/[id]/page.tsx`, `src/app/(private)/applications/load-application.ts` |
| Private pages are never indexed (noindex, not in the sitemap) | `src/app/(private)/layout.tsx`, `src/app/sitemap.ts` |
| Optimistic create, per-field errors (when forms arrive) | next-example's `src/app/notes/_components/` |
| `/api/*` → `API_URL` proxy with the person's token | `src/app/api/[...path]/route.ts` |
| Session cookie, refresh, sign-out | `src/lib/session/`, `src/proxy.ts`, `src/app/auth/` |
| Pages behind sign-in, "Sign in" and the invitation page | `src/app/(private)/layout.tsx`, `src/lib/session/access.ts`, `src/components/access/` |
| Profile editor | `src/app/(private)/profile/` |
| Body cap, request header allow-list | `src/lib/http/body-limit.ts`, `src/lib/http/forwarded-headers.ts` |
| Identity model and threat model | `docs/auth.md` |
| CSP, nonce, locale, request id | `src/proxy.ts`, `src/lib/security/` |
| Metadata, robots, sitemap, OG, icons, manifest, JSON-LD | `src/app/layout.tsx`, `src/app/{robots,sitemap,manifest}.ts`, `src/app/{opengraph-image,icon,apple-icon}.tsx`, `src/lib/seo/` |
| Locales | `src/i18n/` |
| UI components and tokens | `src/components/ui/`, `components.json`, `src/app/globals.css` |
| Env | `src/lib/env/` |
| Logs | `src/lib/logger.ts`, `src/instrumentation.ts` |
| 404 and errors | `src/app/not-found.tsx`, `error.tsx`, `global-error.tsx` |
| Mock API and e2e | `e2e/` (`servers.ts`: ports and budgets of the test servers) |

## How it works

**The API proxy is a route handler, not `rewrites`.** `rewrites` in `next.config.ts` are evaluated at build time, which would bake the API address into the image. The route handler reads `API_URL` at startup (one image for every environment), forwards the request id and an allow-list of headers, enforces the body cap and deadlines below, writes a log line and answers with a contract error when the API is down. The browser talks only to its own origin: no CORS, `connect-src 'self'` in the CSP. The one exception is analytics: with `GTM_ID` set, `connect-src` also allows Google's hosts, for Tag Manager and Google Analytics only. Only `/api/v1/*` is exposed. With accounts on, a write (`POST`, `PUT`, `PATCH`, `DELETE`) needs a session (else `401` without reaching the API) and must come from this site (`Origin`, or `Sec-Fetch-Site: same-origin`; else `403`). `src/proxy.ts` does not run for `/api`: for every request it matches, Next.js buffers the body (up to 10 MB) and waits for all of it before the route handler starts, which would defeat the cap and the body deadline.

**Headers to the API.** The proxy and `serverApi` forward `accept`, `accept-language`, `content-type`, `user-agent`, the request id, and `x-forwarded-for` set to the one address in `x-real-ip` (written by Traefik's `real-ip` middleware, so the API's per-client rate limit still sees the visitor). Everything else is dropped, `authorization`, `cookie`, the client's `x-forwarded-*` and `x-user-*` included. The one identity header is `authorization: Bearer <access token>`, built by this server from the session cookie: [docs/auth.md](docs/auth.md).

**Data.** Query options take the client as the first argument: Server Components pass `await serverApi()` (straight to `API_URL`), client components pass `browserApi` (through `/api`). Same key, same cache.

**Locale.** `?lang=en|ru` > `nl_locale` cookie, on the whole domain > `en`; the browser's language does not decide. `?lang=` rewrites the cookie. `src/proxy.ts` picks the locale and the server renders `<html lang>`. Every URL of the hreflang cluster is its own canonical: `/path?lang=<locale>` points to itself, the bare path to the bare path. hreflang lists both languages, `x-default` is the path without the parameter.

**UI and theme.** Components are shadcn/ui source in `src/components/ui/` (Radix primitives, `cn` from the `cn` package). One light palette: shadcn neutral tokens as CSS variables in `src/app/globals.css`. No theme switch, no `dark:` classes (a unit test rejects them, since components added later bring their own).

**CSP and styles.** Production `style-src` is `'self' 'nonce-…'` plus two hashes, without `unsafe-inline`. No component used here renders a `style` attribute on the server; Sonner's toasts set theirs in the browser through the DOM, which the CSP does not restrict. Sonner does inject its stylesheet as a `<style>` element at runtime, which cannot carry a nonce, so `src/lib/security/csp.ts` allows exactly that stylesheet (and the empty `<style>` it appends first) by SHA-256. A unit test recomputes the hash from `node_modules/sonner`, so a Sonner update that changes its CSS fails `pnpm verify` until the hash is updated; the e2e suite fails on any CSP violation.

**404.** A route that can answer 404 must not have a `loading.tsx` above it: a stream that has started has already sent 200. So the list's `loading.tsx` sits in the `(list)` group and `/applications/[id]` has none.

## Accounts

The account is the one session cookie of every site under the domain (copied from `landing-web`, its README "Accounts"; design: `docs/identity.md` in the org repo). id-web signs in and sets it; this site reads it, refreshes it and sends its access token to tailor-api. Off until `ID_URL`, `ID_API_URL` and `SESSION_SECRET` are set: then every page but `/` needs a person, and `/api` sends their token. Without them (local work against the mock) pages and `/api` work as nobody and `/auth/*` answers 404.

- **The cookie.** `__Secure-nl_session` on the registered domain (`nl_session` with no Domain on plain http): tokens sealed with AES-256-GCM under `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, 30 days.
- **Sign-in** is a link to `${ID_URL}/login?continue=<this page>`, in the header and on every private page without a session.
- **Fresh tokens.** With less than 60 s left on the access token, `src/proxy.ts` refreshes it before the page renders (any request with the cookie, a prefetch or a router fetch too, because the page calls tailor-api with it) and rewrites the cookie, in the request too, so the page already sends the new token. The `/api` route does the same for the browser's calls. A refused refresh drops the cookie.
- **Who.** A page visit asks id-api `GET /api/v1/me` (1 s) for the name in the header and whether the session still stands; nothing else asks it.
- **Tailor by invitation (D-112).** `src/app/(private)/layout.tsx` asks tailor-api `GET /api/v1/me`: signed out → "Sign in"; a person not on `TAILOR_USERS` → "Tailor is by invitation" with their user id to copy and send to the owner. tailor-api checks the token and the list on every call itself.
- **`POST /auth/sign-out`** ends the session at id-api and expires the cookie: signed out of every site in this browser.

## Profile

`/profile` is a plain editor of the profile document (D-98): the JSON tailor-api keeps, formatted, in a textarea; **Save** sends it whole (`PUT /api/v1/profile`) and shows the new version, or every path tailor-api refused with its message; **Upload JSON file** puts a file in the editor (saved only by Save); **Download JSON** saves what is in the editor; **Download master CV (PDF)**, once a version is saved, opens `/api/v1/profile/cv.pdf` in a new tab: tailor-api builds the saved profile into a PDF through tailor-tex (no vacancy, up to about a minute; tailor-api's README, "Master CV"), and the proxy streams it with its `content-type` and `content-disposition` (the file name). Before the first save the editor holds `{}`, which saves as a profile with every section empty. The structure: tailor-api's README, "Profile".

## Request limits and time budgets

From the [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (Request size, Time budgets).

| Limit | Value | Where | Answer |
|---|---|---|---|
| Request body through `/api` | 1 MiB | `MAX_BODY_BYTES` in `src/lib/http/body-limit.ts` | `413` |
| Reading that body | 10 s from the start of the request | `API_BODY_TIMEOUT_MS` | `408` |
| The API call | 10 s from the start of the request | `API_REQUEST_TIMEOUT_MS` (also for server-side calls) | `504` |
| The API call for a PDF it builds (`GET /api/v1/profile/cv.pdf`) | 70 s, above tailor-api's 65 s | `API_RENDER_TIMEOUT_MS`, routes in `RENDER_ROUTES` of the proxy | `504` |
| API unreachable | | | `503` |
| Browser client (`browserApi`) | 12 s | `src/lib/api/client.ts` | `UNAVAILABLE` |

All answers carry the contract error body (`{ code, message, requestId }`; `VALIDATION_FAILED` for 4xx, `INTERNAL` for 5xx).

- A `Content-Length` over the cap is rejected before anything is read. Without one (chunked), the body runs through a counting `TransformStream` that errors on the first byte past 1 MiB.
- Both deadlines start when the handler starts, so a slow body cannot borrow time from the API call. The client going away aborts the API call too.
- The bounded body is buffered and then sent, rather than streamed to the API (`duplex: 'half'`): the API (body parser) needs the whole body before it can answer anyway, and buffering means the API never sees a partial or oversized body and a slow client never holds an API connection or uses up the API's own 10 s budget. At most 1 MiB per request is held in memory.
- What is left of a rejected body is read and discarded for up to 2 s, so the client gets the `413`/`408` instead of a connection reset; after that the connection is closed.
- The contract puts the same 1 MiB cap at the edge too (Traefik `body-limit` middleware, gitops); the proxy's own cap also holds in local runs and for anything that bypasses Traefik.

## Health semantics

| Probe | Answers | Body |
|---|---|---|
| `GET /health/live` | `200` while the process answers; reads no dependency | `{ status: 'ok', version }` |
| `GET /health/ready` | `200` when this server can render (it answered, its config parsed) | `{ status: 'ok' \| 'degraded', version, checks: { api: 'ok' \| 'down' } }` |

Readiness reports the API but does not require it (contract, kind web): with the API down, every web pod stays in the load balancer, pages that need no API keep working, and pages that need it show their own error state (the applications list shows an error with a retry button, an application page shows `error.tsx`). Taking the web out of rotation would turn an API outage into a whole-site outage. The API check has a 2 s timeout, below the probe's 3 s. Both probes return `x-app-version`, which the post-deploy smoke check waits for. The Docker `HEALTHCHECK` uses `/health/ready` with the same meaning.

## End-to-end against a real API

The `real-api` Playwright project runs the applications specs (`e2e/applications.spec.ts`) against a running `tailor-api`. It starts one more server of the same build with `API_URL=$E2E_API_URL`; without `E2E_API_URL` its tests are skipped.

```bash
# terminal 1, in ../tailor-api (its README, "Getting started")
pnpm install
pnpm infra:up           # Postgres in Docker
pnpm env:local
pnpm db:migrate         # also builds dist/
pnpm start              # http://127.0.0.1:4000

# terminal 2, here
pnpm build
E2E_API_URL=http://127.0.0.1:4000 pnpm test:e2e:real
```

The specs create the applications they need through the API and read expected values from it. Stop the API afterwards and `pnpm infra:down` in `../tailor-api` (`pnpm infra:reset` also deletes the data).

## Adding a page

1. `src/app/<path>/page.tsx`, a Server Component.
2. Text in `src/i18n/messages/en.json` and `ru.json` (same keys; a test checks it).
3. `generateMetadata` returns only `title` and `description` through `getTranslations`. The root layout adds canonical, hreflang and Open Graph.
4. Public page: add it to `src/app/sitemap.ts`. Private pages (anything with the user's data) are noindex and stay out of it.
5. Test: e2e in `e2e/`, with an axe check if it has new UI.

## Adding a request

1. The API's OpenAPI document changed: update `e2e/mock-api/openapi.json` (and the mock), then `pnpm api:types` (or `OPENAPI_URL=<url> pnpm api:types` against a running API).
2. Response type in `src/lib/api/types.ts` (by path and status from `schema.d.ts`).
3. In `src/lib/api/<resource>.ts`: endpoint (`api.request<T>(...)`), keys (`xxxKeys`), options (`queryOptions` / `infiniteQueryOptions`), client as the first argument.
4. Server: `await getServerQueryClient().query(xxxQueries.one(await serverApi())).catch(...)` and `HydrationBoundary`. Client: `useQuery(xxxQueries.one(browserApi))`.
5. Mutation: `useMutation` with `mutationKey`, then `invalidateQueries` on the resource keys after success.

## Environment variables

| Variable | Default | Read |
|---|---|---|
| `API_URL` | `http://localhost:4000` | at startup |
| `API_REQUEST_TIMEOUT_MS` | `10000` | at startup; every API call (server-side and the `/api` proxy) |
| `API_BODY_TIMEOUT_MS` | `10000` | at startup; reading a body the `/api` proxy forwards |
| `API_RENDER_TIMEOUT_MS` | `70000` | at startup; the `/api` proxy's call for a PDF tailor-api builds (the master CV) |
| `ID_URL` | none | at startup; id-web's public origin (`https://id.nick-lukashik.com`): "Sign in" links to `${ID_URL}/login?continue=<page>` |
| `ID_API_URL` | none | at startup; id-api in the cluster (`http://id-api.prod.svc`): refresh, `me`, sign-out |
| `SESSION_SECRET` | none | at startup; key of the shared session cookie, 32+ characters, the same on every site under the domain (secret `web-session`). Without all three: no accounts (local work with the mock) |
| `CV_URL` | `http://localhost:4000/api/v1/cv` | at startup; base of the public CV links, `${CV_URL}/<application id>` (tailor-api redirects to `<id>/<Name-Role-CV>.pdf`) (prod: `https://cv.<domain>`) |
| `SITE_URL` | `http://localhost:3000` | at startup |
| `APP_VERSION` | `dev` | at startup (`x-app-version` header) |
| `LOG_LEVEL` | `info` | at startup |
| `ROBOTS` | `index` | per request; `noindex` blocks indexing (stage) |
| `GTM_ID` | none | per request; Google Tag Manager container (`GTM-ABC1234`). Unset: no tag manager, and the CSP stays on this origin. It loads on every visit. The banner says so until "OK", which sets `nl_consent=true` for a year on the whole domain and does nothing else |
| `OPENAPI_URL` | `e2e/mock-api/openapi.json` | by `pnpm api:types` only |

## Docker

```bash
docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t tailor-web .
docker run --rm -p 3000:3000 -e API_URL=http://host.docker.internal:4000 \
  -e SITE_URL=http://localhost:3000 tailor-web
# as in Kubernetes: read-only root filesystem, no capabilities
docker run --rm -p 3000:3000 --read-only --tmpfs /tmp --tmpfs /app/.next/cache \
  --cap-drop ALL --security-opt no-new-privileges --user 10001:10001 \
  -e API_URL=http://host.docker.internal:4000 -e ROBOTS=noindex tailor-web
```

Stages: `base` (Node image) → `deps` (pnpm, `pnpm install` with a cache mount) → `build` (`pnpm build`) → `runtime` (standalone output only). `APP_VERSION` is the only build arg: nothing environment-specific is baked in, so one image runs on stage and prod. App files are owned by root, the app runs as uid `10001` and may write only `/tmp` and `.next/cache` (mode `1777`, so a `--tmpfs` there is writable too). `HEALTHCHECK` runs `healthcheck.mjs` against `/health/ready`; Kubernetes ignores it and uses its probes. `node server.js` is PID 1 and exits on `SIGTERM` after in-flight requests finish.

## Dependency updates

Versions are pinned exactly. [Renovate](https://docs.renovatebot.com/) (`renovate.json`) opens PRs on Monday early morning (`Asia/Tbilisi`): one PR for all non-major updates, one per major, weekly lockfile maintenance. It covers npm packages, `packageManager`, `.node-version`, the Dockerfile base image tag, GitHub Actions (pinned by digest) and the `pnpm dlx` pins in `scripts/api-types.mjs`. Releases younger than 3 days are skipped, the same as pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml`. Renovate needs the [Renovate GitHub app](https://github.com/apps/renovate) installed on the organization (or this repository). Check the config with `pnpm dlx --package renovate renovate-config-validator --strict`.

## CI

`.github/workflows/ci.yml` calls the org reusable workflows from `nick-lukashik/.github` by the moving major tag `@v1`:

- job `ci`: `build.yml@v1` with `kind: web`. It runs `pnpm verify`, then `pnpm test:e2e` on that same build (the mock API, plus servers of the same build with `ROBOTS=noindex`, one whose API is down, and one with accounts on against `e2e/mock-id.mjs`), then builds the image; on `master` it pushes it to GHCR. The required check is `ci / verify`.
- job `deploy`: on `master`, when an image was pushed: `deploy-pr.yml@v1` opens the gitops PR with the new digest; the owner's merge is the deploy.

## Deploy

The image follows the [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (kind **web**).

- gitops `apps/tailor-web/prod`: `components/service`, `components/web`, `components/subdomain` (`tailor`), the image by digest.
- ConfigMap `tailor-web-config`: `API_URL=http://tailor-api.prod.svc`, `SITE_URL` and `CV_URL` derived from the hosts (`https://tailor.<domain>`, `https://cv.<domain>`), `ID_URL`, `ID_API_URL`, `ROBOTS=noindex`; `SESSION_SECRET` from the SealedSecret `web-session` (`components/web`); egress to id-api (`api-client`). id-web must list `https://tailor.<domain>` in `FORM_ACTION_ORIGINS`, or "Sign in" does not come back here. tailor-api lists tailor-web as its caller in its own folder.
- Probes: `/health/live` and `/health/ready` (reports the API, does not require it). Both return `x-app-version`, which the post-deploy smoke check waits for.

## Limitations

- One OG image, in English: link previews arrive without the locale cookie.
- `openapi-typescript` 7 does not work with TypeScript 7 (no JS API), so `pnpm api:types` runs it through `pnpm dlx` with TypeScript 5.9; the versions are pinned in `scripts/api-types.mjs`.
- The `real-api` project starts its site without accounts, and tailor-api now answers 401 to a call without an id-api token, so those specs fail against a real API until the run gets a real id (or a stand-in that signs ES256 tokens).
