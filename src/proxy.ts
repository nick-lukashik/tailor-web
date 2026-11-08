import { type NextRequest, NextResponse } from 'next/server'
import { LOCALE_COOKIE, LOCALE_HEADER, LOCALE_PARAM, localeCookieOptions } from '@/i18n/config'
import { resolveLocale } from '@/i18n/resolve'
import { serverEnv } from '@/lib/env/server'
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/request-id'
import { buildCsp, createNonce, NONCE_HEADER } from '@/lib/security/csp'
import { CANONICAL_HEADER, canonicalPath, PATHNAME_HEADER } from '@/lib/seo/alternates'
import { hasTailorRole } from '@/lib/session/claims'
import {
    ACCOUNT_HEADER,
    type Account,
    accountHeader,
    accounts,
    cookieName,
    currentAccount,
    expiredSessionCookie,
    isPageVisit,
    keepFresh,
    openSession,
    SESSION_MAX_AGE,
    sealSession,
    sessionCookieOptions,
} from '@/lib/session/session'

// Read at runtime: the same image reports what the deploy sets.
const version = process.env.APP_VERSION || 'dev'

/** Probes: no CSP, no locale. */
const isMachinePath = (path: string) => path.startsWith('/health/')
/** Served to anyone: the probes, and robots.txt, which says only "disallow everything". */
const isPublicPath = (path: string) => isMachinePath(path) || path === '/robots.txt'

/** A bare 307: nothing but the target (Next.js echoes it as the body), nothing that tells what this site is. */
const redirectAway = () =>
    new NextResponse(null, {
        status: 307,
        headers: {
            location: new URL(serverEnv.HOME_URL).href,
        },
    })

/**
 * Every request but /api: a request id (kept from the edge or new) and the app
 * version. Pages also get a per-request CSP nonce, the resolved locale
 * (?lang= > cookie > English) and their path for metadata. With accounts on, a
 * visitor with the session cookie has its token kept fresh before the page renders
 * (the pages send it to tailor-api), and a page visit learns who they are. A visitor
 * without it costs no call at all.
 *
 * With accounts on, every path but the public ones needs a session whose access token
 * carries the `tailor` role: anyone else gets a 307 to the platform's landing
 * (HOME_URL), with no message and nothing rendered, so nothing says what this site is.
 */
export async function proxy(request: NextRequest) {
    const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER))
    const gated = !isPublicPath(request.nextUrl.pathname)
    const account = gated ? await keepAccount(request) : undefined
    if (accounts && gated && !account?.allowed) return away(requestId, account)
    // After keepAccount: a refreshed session is in the request's cookie for the page too.
    const forwarded = new Headers(request.headers)
    forwarded.set(REQUEST_ID_HEADER, requestId)
    // Only this proxy says who the person is, never the browser.
    forwarded.delete(ACCOUNT_HEADER)
    if (account?.who) forwarded.set(ACCOUNT_HEADER, accountHeader(account.who))

    const { pathname, searchParams, protocol } = request.nextUrl
    const page = !isMachinePath(pathname)
    const https = request.headers.get('x-forwarded-proto') === 'https' || protocol === 'https:'

    let csp: string | undefined
    let persistLocale: string | undefined
    if (page) {
        const nonce = createNonce()
        csp = buildCsp({
            nonce,
            dev: process.env.NODE_ENV === 'development',
            https,
            analytics: Boolean(serverEnv.GTM_ID),
            // "Sign out" ends on the landing.
            formTargets: accounts
                ? [
                      new URL(serverEnv.HOME_URL).origin,
                  ]
                : [],
        })
        // Next.js reads the nonce from the request's CSP and puts it on its scripts.
        forwarded.set('content-security-policy', csp)
        forwarded.set(NONCE_HEADER, nonce)

        const locale = resolveLocale({
            query: searchParams.get(LOCALE_PARAM),
            cookie: request.cookies.get(LOCALE_COOKIE)?.value,
        })
        forwarded.set(LOCALE_HEADER, locale.locale)
        forwarded.set(PATHNAME_HEADER, pathname)
        forwarded.set(CANONICAL_HEADER, canonicalPath(pathname, locale.locale, locale.source === 'query'))
        if (locale.persist) persistLocale = locale.locale
    }

    const response = NextResponse.next({
        request: {
            headers: forwarded,
        },
    })
    response.headers.set(REQUEST_ID_HEADER, requestId)
    response.headers.set('x-app-version', version)
    account?.write?.(response)
    if (csp) response.headers.set('content-security-policy', csp)
    if (persistLocale) {
        response.cookies.set(LOCALE_COOKIE, persistLocale, localeCookieOptions(https, serverEnv.SITE_URL))
    }
    return response
}

type AccountStep = {
    /** Signed in: who, as far as this request knows. */
    who?: Account
    /** The session cookie changed. */
    write?: (response: NextResponse) => void
    /** Signed in, and the access token carries the `tailor` role. */
    allowed?: boolean
}

/** To the platform's landing, as if this site were not here; a changed cookie still goes with it. */
function away(requestId: string, account: AccountStep | undefined) {
    const response = redirectAway()
    response.headers.set('cache-control', 'private, no-store')
    response.headers.set(REQUEST_ID_HEADER, requestId)
    response.headers.set('x-app-version', version)
    account?.write?.(response)
    return response
}

const UNNAMED: Account = {
    name: null,
    email: null,
}

/**
 * The session before the page renders (landing-web's, with one difference). Any
 * request with the cookie gets a fresh access token when it is about to expire, a
 * prefetch or a router fetch too: Tailor's pages call tailor-api with it, so a stale
 * one would fail them (at most one refresh per token, every 5 minutes). Only a page
 * visit asks id-api who the person is, which also tells a session ended elsewhere: the
 * cookie goes then. Without the cookie nothing is asked at all, and without the `tailor`
 * role in the token (claims.ts) nothing more than the refresh.
 */
async function keepAccount(request: NextRequest): Promise<AccountStep | undefined> {
    if (!accounts) return undefined
    const name = cookieName()
    const sealed = request.cookies.get(name)?.value
    if (!sealed) return undefined
    const drop = (): AccountStep => {
        request.cookies.delete(name)
        return {
            write: response => response.cookies.set(name, '', expiredSessionCookie()),
        }
    }
    const opened = openSession(accounts, sealed)
    if (!opened) return drop()

    const fresh = await keepFresh(accounts, opened)
    if (fresh === 'ended') return drop()
    let write: AccountStep['write']
    if (fresh.refreshed) {
        const value = sealSession(accounts, fresh.session)
        request.cookies.set(name, value)
        write = response => response.cookies.set(name, value, sessionCookieOptions(SESSION_MAX_AGE))
    }
    // The shared session stays: it is the person's sign-in for every other site too.
    if (!hasTailorRole(fresh.session.accessToken))
        return {
            write,
        }
    if (!isPageVisit(request.method, request.headers))
        return {
            who: UNNAMED,
            write,
            allowed: true,
        }
    const who = await currentAccount(accounts, fresh.session.accessToken)
    if (who === 'ended') return drop()
    return {
        who: who ?? UNNAMED,
        write,
        allowed: true,
    }
}

export const config = {
    // Everything but build assets, the image optimizer and the /api proxy,
    // prefetches included: a prefetched page may be the one shown, so it
    // needs its CSP too. /api is left out because Next.js buffers the body of
    // every request the proxy runs for (up to 10 MB, until it has all of it);
    // the route handler sets the request id and version there itself.
    matcher: [
        '/((?!_next/static/|_next/image|api/).*)',
    ],
}
