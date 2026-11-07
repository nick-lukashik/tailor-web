import 'server-only'
import { z } from 'zod'

const blankAsMissing = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const unsetIfBlank = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsMissing, schema)

/**
 * Server-only configuration, read at runtime (one image for every
 * environment). Parsed on first import: instrumentation.ts imports it at
 * startup, so a bad value stops the server instead of failing every page.
 */
const schema = z
    .object({
        /** Backend base URL; the browser never sees it (it calls /api on this origin). */
        API_URL: unsetIfBlank(z.url().default('http://localhost:4000')),
        /** Base of the public CV links (tailor-api's CV files): `${CV_URL}/<application id>` (tailor-api redirects to `<id>/<Name-Role-CV>.pdf`). In prod https://cv.<domain>. */
        CV_URL: unsetIfBlank(z.url().default('http://localhost:4000/api/v1/cv')),
        /** The /api proxy forwards only GET and HEAD: prod has no sign-in yet, so nobody writes through it. */
        API_READ_ONLY: unsetIfBlank(z.stringbool().default(false)),
        /** Public origin of this site: canonical URLs, sitemap, Open Graph. */
        SITE_URL: unsetIfBlank(z.url().default('http://localhost:3000')),
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
        /** Budget for reading a request body the /api proxy forwards. */
        API_BODY_TIMEOUT_MS: unsetIfBlank(z.coerce.number().int().positive().default(10_000)),
        /** `noindex` (stage): robots.txt disallows everything, pages say noindex. */
        /** Google Tag Manager container (GTM-ABC1234). Set: the container on every visit, and a banner with "OK" that says so. Unset: neither, and the CSP stays on this origin. */
        GTM_ID: unsetIfBlank(
            z
                .string()
                .regex(/^GTM-[A-Z0-9]{4,12}$/, 'a container id like GTM-ABC1234')
                .optional(),
        ),
        ROBOTS: unsetIfBlank(
            z
                .enum([
                    'index',
                    'noindex',
                ])
                .default('index'),
        ),
    })
    .transform(env => ({
        ...env,
        API_URL: env.API_URL.replace(/\/+$/, ''),
        SITE_URL: env.SITE_URL.replace(/\/+$/, ''),
        CV_URL: env.CV_URL.replace(/\/+$/, ''),
    }))

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`)
}
export const serverEnv = parsed.data
