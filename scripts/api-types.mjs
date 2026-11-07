// Regenerates src/lib/api/schema.d.ts from an OpenAPI document of the tailor-api contract.
//   pnpm api:types                                   # e2e/mock-api/openapi.json (default)
//   OPENAPI_URL=http://localhost:4000/openapi.json pnpm api:types
//   pnpm api:types https://api.example.com/openapi.json   # a URL or file; wins over OPENAPI_URL
//   pnpm api:types -- --check                        # fail if the committed file is stale
// OPENAPI_URL may also be set in .env.local. openapi-typescript needs the
// TypeScript 5 JS API, which TypeScript 7 (the project's compiler) no longer
// ships, so it runs pinned through `pnpm dlx`.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const DEFAULT_SOURCE = 'e2e/mock-api/openapi.json'
const args = process.argv.slice(2).filter(arg => arg !== '--')
const flags = args.filter(arg => arg.startsWith('--'))
const source = args.find(arg => !arg.startsWith('--')) ?? (process.env.OPENAPI_URL || DEFAULT_SOURCE)
const output = 'src/lib/api/schema.d.ts'

const run = (command, args) => {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`openapi-typescript ${source} -> ${output}`)
run('pnpm', [
    '--package=openapi-typescript@7.13.0',
    '--package=typescript@5.9.3',
    'dlx',
    'openapi-typescript',
    source,
    '--output',
    output,
    ...flags,
])
