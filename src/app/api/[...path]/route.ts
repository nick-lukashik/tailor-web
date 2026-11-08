import { type NextRequest } from 'next/server'
import { type ApiErrorBody } from '@/lib/api/errors'
import { serverEnv } from '@/lib/env/server'
import { BodyTooLargeError, declaredLength, discardBody, MAX_BODY_BYTES, readBody } from '@/lib/http/body-limit'
import { proxiedRequestHeaders } from '@/lib/http/forwarded-headers'
import { logger } from '@/lib/logger'
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/request-id'
import {
    accounts,
    cookieName,
    expiredSessionCookie,
    keepFresh,
    openSession,
    SESSION_MAX_AGE,
    type Session,
    sealSession,
    sessionCookieOptions,
} from '@/lib/session/session'

/**
 * Same-origin proxy: /api/:path* → ${API_URL}/api/:path*. A route handler
 * rather than a rewrite because API_URL is read at runtime (rewrites are
 * fixed at build time), and so every call carries the request id, the
 * service contract's limits (1 MiB body, 10 s to read it, 10 s for the
 * API), an access log line and a contract error when the API is down.
 *
 * Identity (docs/auth.md): the person's access token from the session cookie
 * goes as `Authorization: Bearer`, refreshed here when it is about to expire
 * (the new cookie comes back with the answer). With accounts on, a write needs
 * a session and must come from this site's own pages (Origin / Sec-Fetch-Site);
 * a read without a session goes on as nobody, and tailor-api answers 401.
 *
 * src/proxy.ts does not run for /api: with a proxy, Next.js would buffer
 * up to 10 MB of every body and wait for all of it before this handler starts.
 */
export const dynamic = 'force-dynamic'

const WRITES = new Set([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
])

/**
 * A write sent by a page of this site, not by another one in the same browser
 * (CSRF): browsers send Origin with every write fetch, and Sec-Fetch-Site. A client
 * that sends neither is not a browser, so it is not riding someone's cookie.
 */
function sameOrigin(headers: Headers) {
    const origin = headers.get('origin')
    if (origin) return origin === new URL(serverEnv.SITE_URL).origin
    const site = headers.get('sec-fetch-site')
    return site === null || site === 'same-origin'
}

type Identity = {
    session?: Session
    /** The cookie changed: refreshed, or dropped after a refused refresh. */
    cookie?: {
        value: string
        maxAge: number
    }
}

/** The session of the request, its token kept fresh. Nothing without accounts or the cookie. */
async function identify(request: NextRequest): Promise<Identity> {
    if (!accounts) return {}
    const opened = openSession(accounts, request.cookies.get(cookieName())?.value)
    if (!opened) return {}
    const fresh = await keepFresh(accounts, opened)
    if (fresh === 'ended')
        return {
            cookie: {
                value: '',
                maxAge: 0,
            },
        }
    return {
        session: fresh.session,
        ...(fresh.refreshed
            ? {
                  cookie: {
                      value: sealSession(accounts, fresh.session),
                      maxAge: SESSION_MAX_AGE,
                  },
              }
            : {}),
    }
}

const RESPONSE_HEADERS = [
    'content-type',
    'cache-control',
    'retry-after',
    'location',
    'etag',
]
/** How long a rejected body is still read (and discarded) so the client sees the error. */
const DISCARD_MS = 2000

function errorResponse(status: number, body: ApiErrorBody) {
    return Response.json(body, {
        status,
        headers: {
            'cache-control': 'no-store',
            'x-app-version': serverEnv.APP_VERSION,
            [REQUEST_ID_HEADER]: body.requestId,
        },
    })
}

async function forward(request: NextRequest, { params }: RouteContext<'/api/[...path]'>) {
    // Both budgets start with the request: a slow body cannot borrow from the API's time.
    const bodyDeadline = AbortSignal.timeout(serverEnv.API_BODY_TIMEOUT_MS)
    const upstreamDeadline = AbortSignal.timeout(serverEnv.API_REQUEST_TIMEOUT_MS)
    const started = performance.now()
    const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER))
    const log = logger.child({
        requestId,
    })
    const access = {
        method: request.method,
        path: request.nextUrl.pathname,
    }
    const reject = (status: number, code: ApiErrorBody['code'], message: string) => {
        log.warn(
            {
                ...access,
                status,
                durationMs: Math.round(performance.now() - started),
            },
            message,
        )
        if (request.body) discardBody(request.body, DISCARD_MS)
        return errorResponse(status, {
            code,
            message,
            requestId,
        })
    }

    const { path } = await params
    // Only the versioned API is exposed; nothing else of the backend.
    if (path[0] !== 'v1') return reject(404, 'NOT_FOUND', 'Not found')
    const write = WRITES.has(request.method)
    if (accounts && write && !sameOrigin(request.headers)) return reject(403, 'FORBIDDEN', 'Cross-site write refused')
    const identity = await identify(request)
    // Nobody writes through a public site without signing in.
    if (accounts && write && !identity.session) {
        return withCookie(reject(401, 'UNAUTHORIZED', 'Sign in to make changes'), identity)
    }

    let body: Uint8Array<ArrayBuffer> | undefined
    if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
        const tooLarge = `Request body is larger than ${MAX_BODY_BYTES} bytes`
        if ((declaredLength(request.headers) ?? 0) > MAX_BODY_BYTES) {
            return reject(413, 'VALIDATION_FAILED', tooLarge)
        }
        try {
            // Bounded in memory; the API only ever gets a complete body (see README).
            body = await readBody(request.body, {
                limit: MAX_BODY_BYTES,
                signal: AbortSignal.any([
                    request.signal,
                    bodyDeadline,
                ]),
            })
        } catch (error) {
            if (error instanceof BodyTooLargeError) return reject(413, 'VALIDATION_FAILED', tooLarge)
            if (bodyDeadline.aborted) return reject(408, 'VALIDATION_FAILED', 'Request body timed out')
            return reject(400, 'VALIDATION_FAILED', 'Request body could not be read')
        }
    }

    const target = `${serverEnv.API_URL}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`
    const upstreamHeaders = proxiedRequestHeaders(request.headers, requestId)
    if (identity.session) upstreamHeaders.set('authorization', `Bearer ${identity.session.accessToken}`)
    let upstream: Response
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers: upstreamHeaders,
            body,
            // Aborted when the client goes away, too: the API stops working for nobody.
            signal: AbortSignal.any([
                request.signal,
                upstreamDeadline,
            ]),
            cache: 'no-store',
            redirect: 'manual',
        })
    } catch (error) {
        if (request.signal.aborted) {
            log.info(access, 'client closed the request')
            return new Response(null, {
                status: 499,
            })
        }
        const timedOut = upstreamDeadline.aborted
        log.error(
            {
                ...access,
                ...(timedOut
                    ? {}
                    : {
                          err: error,
                      }),
                durationMs: Math.round(performance.now() - started),
            },
            timedOut ? 'api timed out' : 'api unreachable',
        )
        return withCookie(
            errorResponse(timedOut ? 504 : 503, {
                code: 'INTERNAL',
                message: timedOut ? 'The API did not answer in time' : 'The API is unavailable',
                requestId,
            }),
            identity,
        )
    }

    log[upstream.status >= 500 ? 'error' : 'info'](
        {
            ...access,
            status: upstream.status,
            durationMs: Math.round(performance.now() - started),
        },
        'api proxy',
    )

    const responseHeaders = new Headers({
        'x-app-version': serverEnv.APP_VERSION,
        [REQUEST_ID_HEADER]: requestId,
    })
    for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) responseHeaders.set(name, value)
    }
    if (!responseHeaders.has('cache-control')) responseHeaders.set('cache-control', 'no-store')
    return withCookie(
        new Response(upstream.body, {
            status: upstream.status,
            headers: responseHeaders,
        }),
        identity,
    )
}

/** The refreshed (or dropped) session cookie on the answer; the API's own cookies never pass. */
function withCookie(response: Response, identity: Identity) {
    if (!identity.cookie) return response
    const options = identity.cookie.maxAge ? sessionCookieOptions(identity.cookie.maxAge) : expiredSessionCookie()
    const parts = [
        `${cookieName()}=${identity.cookie.value}`,
        `Path=${options.path}`,
        `Max-Age=${options.maxAge}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(options.secure
            ? [
                  'Secure',
              ]
            : []),
        ...('domain' in options && options.domain
            ? [
                  `Domain=${options.domain}`,
              ]
            : []),
    ]
    response.headers.append('set-cookie', parts.join('; '))
    response.headers.set('cache-control', 'private, no-store')
    return response
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT }
