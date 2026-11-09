import 'server-only'
import { z } from 'zod'

const blankAsMissing = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const unsetIfBlank = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsMissing, schema)
/** `next build` evaluates route modules too; the image is built without secrets. */
const building = process.env.NEXT_PHASE === 'phase-production-build'

/**
 * Server-only configuration, read at runtime (one image for every
 * environment). Parsed on first import: instrumentation.ts imports it at
 * startup, so a bad value stops the server instead of failing every page.
 */
const schema = z
    .object({
        /** Backend base URL; the browser never sees it (it calls /api on this origin). */
        API_URL: unsetIfBlank(z.url().default('http://localhost:4000')),
        /**
         * The account. Public origin of id-web (https://id.nick-lukashik.com),
         * id-api inside the cluster, and the key of the session cookie every site
         * under the domain shares: the same value as id-web's. Without all three
         * the site has no accounts (local work against the mock): no sign-in, the
         * /auth routes answer 404 and the /api proxy calls the API as nobody.
         */
        ID_URL: unsetIfBlank(z.url().optional()),
        ID_API_URL: unsetIfBlank(z.url().optional()),
        SESSION_SECRET: building
            ? z.string().optional()
            : unsetIfBlank(z.string().min(32, 'at least 32 characters').optional()),
        /** Public origin of this site: canonical URLs, Open Graph. */
        SITE_URL: unsetIfBlank(z.url().default('http://localhost:3000')),
        /**
         * The platform's landing. With accounts on, a visitor without a session or without
         * the `tailor` role is sent there (307), with no word of what this site is.
         */
        HOME_URL: unsetIfBlank(z.url().default('https://nick-lukashik.com')),
        /** Build or release identifier, sent as x-app-version. */
        APP_VERSION: unsetIfBlank(z.string().max(64).default('dev')),
        LOG_LEVEL: unsetIfBlank(
            z
                .enum([
                    'fatal',
                    'error',
                    'warn',
                    'info',
                    'debug',
                    'trace',
                    'silent',
                ])
                .default('info'),
        ),
        /** Budget of every backend call: server-side requests and the /api proxy's upstream call. */
        API_REQUEST_TIMEOUT_MS: unsetIfBlank(z.coerce.number().int().positive().default(10_000)),
        /** Budget of the /api proxy's call for a PDF that tailor-api builds (the master CV): above its own 65 s. */
        API_RENDER_TIMEOUT_MS: unsetIfBlank(z.coerce.number().int().positive().default(70_000)),
        /** Budget for reading a request body the /api proxy forwards. */
        API_BODY_TIMEOUT_MS: unsetIfBlank(z.coerce.number().int().positive().default(10_000)),
        /** Google Tag Manager container (GTM-ABC1234). Set: the container on every visit, and a banner with "OK" that says so. Unset: neither, and the CSP stays on this origin. */
        GTM_ID: unsetIfBlank(
            z
                .string()
                .regex(/^GTM-[A-Z0-9]{4,12}$/, 'a container id like GTM-ABC1234')
                .optional(),
        ),
    })
    .transform(env => ({
        ...env,
        API_URL: env.API_URL.replace(/\/+$/, ''),
        SITE_URL: env.SITE_URL.replace(/\/+$/, ''),
        ID_URL: env.ID_URL?.replace(/\/+$/, ''),
        ID_API_URL: env.ID_API_URL?.replace(/\/+$/, ''),
    }))

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`)
}
export const serverEnv = parsed.data
