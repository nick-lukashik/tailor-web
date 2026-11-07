Source: official docs (summarized). https://openapi-ts.dev/introduction, https://openapi-ts.dev/cli, https://openapi-ts.dev/advanced

# openapi-typescript 7.13

openapi-ts publishes no agent rules, Skills or llms.txt. The flags below were checked in
`node_modules/openapi-typescript/bin/cli.js`.

## TypeScript 7 and how it runs here

- openapi-typescript 7.13.0 declares `peerDependencies: { "typescript": "^5.x" }` and calls the TypeScript JS
  API (`ts.factory`). TypeScript 7 (the project's compiler) ships no JS API, so the CLI crashes when it
  resolves the project's TypeScript. It is therefore not a devDependency: `scripts/api-types.mjs` runs it
  with `pnpm --package=openapi-typescript@7.13.0 --package=typescript@5.9.3 dlx ...`. Bump both pins there.
- `pnpm api:types [source]` writes `src/lib/api/schema.d.ts`. The source is the argument (URL or file), else
  `OPENAPI_URL` (env or `.env.local`), else `e2e/mock-api/openapi.json`, the tailor-api contract the mock serves.
  Extra flags pass through: `pnpm api:types -- --check`.
- Never hand-edit the generated file.

## Workflow

- The generated types file in `src/lib/api/` is committed and machine-owned. Never edit it by hand.
  When the contract changes, update `e2e/mock-api/openapi.json` (and the mock server), regenerate with
  `pnpm api:types`, and commit both with the code that uses them.
- Drift check: `pnpm api:types -- --check` exits non-zero if the committed file is stale.
- Keep the generated file excluded from Biome (`!` pattern in `files.includes`). Otherwise reformatting
  causes `--check` drift.
- Change generator flags only in the `api:types` script.
- Available 7.x flags: `--enum` / `--enum-values` (instead of unions), `--immutable` (readonly),
  `--root-types` (top-level aliases for `components`), `--export-type`, `--alphabetize`,
  `--path-params-as-types`, `--exclude-deprecated`, `--read-write-markers`.
- `--default-non-nullable` is on by default: schema fields that have a `default` come out non-optional
  (parameters excepted).

## Using the types

- Import types only: `import type { paths, components, operations } from '<generated file>'`.
- Schema models: `components['schemas']['User']`.
- Response body: `paths['/users/{id}']['get']['responses'][200]['content']['application/json']`. The status is
  a numeric key, and the media type maps straight to the schema type (no `['schema']`).
- Parameters: `paths['/users/{id}']['get']['parameters']['path']` (and `['query']`). Request body:
  `paths['/users']['post']['requestBody']['content']['application/json']`.
- Inside features, use the aliases in `src/lib/api/types.ts` (picked by path and status, not by schema
  name, so a renamed backend DTO does not break the frontend). If an alias is missing, add it there.
- The types exist only at compile time and validate nothing. Where runtime safety matters, parse with Zod at
  the boundary.
- Keep field names exactly as the schema defines them (for example `snake_case`). Never rename them at runtime.
- openapi-ts recommends `noUncheckedIndexedAccess`, so `additionalProperties` maps read as `T | undefined`.
- Ask before adding `openapi-fetch` or another generator. The client is built on these types alone.
