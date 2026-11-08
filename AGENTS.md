<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# tailor-web: rules for agents

The site of Tailor on `tailor.<domain>` (a CV and a cover letter for each vacancy), created from `next-starter` plus the API part of `next-example`: Next.js 16.4 (App Router, `output: 'standalone'`, React Compiler, typed routes), React 19.3, TypeScript 7 (strict), Node 26, pnpm 12, TanStack Query 5, next-intl 4 (EN/RU, no locale in the URL), Zod 4, Tailwind 4, shadcn/ui (Radix), Pino, Biome, Vitest 5, Playwright 1.64 + axe. Backend: `tailor-api` (its OpenAPI copy in `e2e/mock-api/openapi.json`); the bundled mock serves the same contract for development and tests. Sign-in through `id` (the shared session cookie, as `landing-web`), the person's applications and their profile (a JSON editor); everything but `/robots.txt` and `/health/*` needs a signed-in person whose access token carries the `tailor` role; anyone else gets a bare 307 to the platform's landing (`HOME_URL`) and `/api` a 404.

## Library rules

Read a library's file before working with it. The first line of each file names its source.

| File | Library |
|---|---|
| [.claude/rules/nextjs.md](.claude/rules/nextjs.md) | Next.js: docs in `node_modules/next/dist/docs/`, proxy, CSP, metadata |
| [.claude/rules/react.md](.claude/rules/react.md) | React 19 and React Compiler |
| [.claude/rules/tanstack-query.md](.claude/rules/tanstack-query.md) | TanStack Query: clients, keys, hydration, mutations |
| [.claude/rules/next-intl.md](.claude/rules/next-intl.md) | next-intl without i18n routing |
| [.claude/rules/zod.md](.claude/rules/zod.md) | Zod 4: env, validation at boundaries |
| [.claude/rules/tailwindcss.md](.claude/rules/tailwindcss.md) | Tailwind 4: tokens, one light theme |
| [.claude/rules/shadcn.md](.claude/rules/shadcn.md) | shadcn/ui: CLI, components, CSP |
| [.claude/rules/openapi-typescript.md](.claude/rules/openapi-typescript.md) | API types from OpenAPI (`pnpm api:types`) |
| [.claude/rules/vitest.md](.claude/rules/vitest.md) | unit tests |
| [.claude/rules/playwright.md](.claude/rules/playwright.md) | e2e and axe |
| [.claude/rules/biome.md](.claude/rules/biome.md) | linter and formatter |

## Where things are

- `src/proxy.ts`: every request but `/api/*` (Next.js would buffer those bodies) gets a request id and `x-app-version`; pages also get the nonce CSP, the locale (`?lang=` > cookie > English) and `x-pathname` for metadata. With accounts on it keeps the session's access token fresh (any request with the cookie), sends anyone without a session or without the `tailor` role to `HOME_URL` (307, nothing rendered) and, on a page visit, asks id-api who the person is (`x-nl-account` for the header).
- `src/lib/session/`: the session cookie (`seal.ts`, `session.ts`, copied from landing-web), `request.ts` (the session of a Server Component's request), `claims.ts` (the `roles` claim of the access token, read without checking the signature; `TAILOR_ROLE`), `access.ts` (open / denied / allowed, from tailor-api `GET /me`).
- `src/app/`: routes. `layout.tsx` holds shared metadata and JSON-LD; `(private)/` holds every page that needs a person (its `layout.tsx` redirects anyone tailor-api does not let in to `HOME_URL`, noindex); `page.tsx` only redirects to `/applications`: `applications/` (the list and the page of an application) and `profile/` (the JSON editor and the master CV link); `auth/sign-out` and `auth/error` end the session; `api/[...path]/route.ts` proxies the browser to the backend (the person's access token as `Authorization: Bearer`, 404 without a session with the `tailor` role, writes only from this origin, 1 MiB body cap, body and upstream deadlines (longer for the master CV PDF, `RENDER_ROUTES`), header allow-lists both ways); `health/live` and `health/ready` are the probes (ready reports the API, does not require it).
- `src/lib/api/`: typed client. `schema.d.ts` (generated, never edit), `types.ts`, `client.ts`, `errors.ts` (`ApiError`), `applications.ts` (endpoints, keys, query options), `server.ts` / `browser.ts` (clients for server and browser).
- `src/lib/query/`: `QueryClient`, a singleton in the browser and one per request on the server.
- `src/lib/env/`: env through Zod, `server.ts` (server only, read at startup). No `NEXT_PUBLIC_*`: one image runs on stage and prod, so nothing environment-specific is inlined at build time (`HOME_URL` is runtime env too).
- `src/lib/http/`: the proxy's body cap (`body-limit.ts`) and the allow-list of request headers sent to the API (`forwarded-headers.ts`, also used by `serverApi`).
- `src/lib/security/`: CSP and static headers. `src/lib/seo/`: alternates, robots, Open Graph.
- `src/i18n/`: locales, locale resolution, next-intl config, catalogs `messages/{en,ru}.json`.
- `src/components/ui/`: shadcn/ui components (source, owned here). `src/components/`: header, footer, language switch.
- `e2e/`: Playwright and `mock-api/` (the tailor-api contract: `openapi.json` and an in-memory server with test hooks). `servers.ts` holds the test servers' ports and budgets. Project `real-api` runs `applications.spec.ts` against `E2E_API_URL`.
- `docs/auth.md`: how identity passes through the proxy and its threat model.

## Conventions

- The browser calls only `/api/*` on its own origin. `API_URL` never reaches client code.
- Headers to the API come only from the allow-list in `src/lib/http/forwarded-headers.ts`, plus `authorization` built from the session (the `/api` route and `serverApi`). Never forward a client's `cookie`, `authorization`, `x-forwarded-*` or `x-user-*` (`docs/auth.md`).
- A new private page goes under `src/app/(private)/`, and its page and `generateMetadata` return early unless `mayEnter(await requestAccess())`: a page's metadata runs even when the layout redirects.
- Nothing a crawler or a link preview can see (root metadata, OG image, manifest, robots.txt) may say what Tailor is for; `e2e/seo.spec.ts` checks it.
- New API resource: type in `src/lib/api/types.ts` (from `schema.d.ts`); endpoints, keys and options in `src/lib/api/<resource>.ts`; options take the client as the first argument.
- A page exports only `title` and `description` through `generateMetadata` + `getTranslations`; the root layout sets canonical, hreflang and `og:url`.
- All text lives in `src/i18n/messages/en.json` and `ru.json` with the same keys (a unit test checks it). Write Russian copy by hand, not machine-translated.
- UI comes from shadcn/ui (`pnpm exec shadcn add <name>`), see `.claude/rules/shadcn.md`. One light theme: colours are tokens from `src/app/globals.css`, no `dark:` classes (a unit test checks it), AA contrast. No server-rendered `style={...}`: the CSP blocks inline styles.
- Server modules start with `import 'server-only'`. Read `process.env` only in `src/lib/env/` (plus `APP_VERSION`/`NODE_ENV` in the proxy and instrumentation).
- English everywhere (code, comments, docs, tests) except the product copy in `ru.json`. Comments are short and to the point.
- Code style is Biome's (`biome.json`): 4-space indent, single quotes (double in JSX), no semicolons, trailing commas, `type` over `interface`, inline `type` imports, `T[]` arrays, kebab-case file names. Run `pnpm format`.
- Dependencies are pinned to exact versions (`savePrefix: ""`); Renovate updates them (`renovate.json`).
- No secrets, real IPs or emails in files: only `example.com`.

## Check before handing over

```bash
pnpm verify      # biome + next typegen && tsc + vitest + next build
pnpm test:e2e    # Playwright against the standalone build and the mock API
# optional, with a real API running (README, "End-to-end against a real API"):
E2E_API_URL=http://127.0.0.1:4000 pnpm test:e2e:real
```

Report the commands and their actual result.
