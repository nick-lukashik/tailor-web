import { type NextRequest, NextResponse } from 'next/server'
import { LOCALE_COOKIE, LOCALE_HEADER, LOCALE_PARAM, localeCookieOptions } from '@/i18n/config'
import { resolveLocale } from '@/i18n/resolve'
import { serverEnv } from '@/lib/env/server'
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/request-id'
import { buildCsp, createNonce, NONCE_HEADER } from '@/lib/security/csp'
import { CANONICAL_HEADER, canonicalPath, PATHNAME_HEADER } from '@/lib/seo/alternates'
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

/**
 * Every request but /api: a request id (kept from the edge or new) and the app
 * version. Pages also get a per-request CSP nonce, the resolved locale
 * (?lang= > cookie > English) and their path for metadata. With accounts on, a
 * visitor with the session cookie has its token kept fresh before the page renders
 * (the pages send it to tailor-api), and a page visit learns who they are. A visitor
 * without it costs no call at all.
 */
export async function proxy(request: NextRequest) {
    const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER))
    const account = isMachinePath(request.nextUrl.pathname) ? undefined : await keepAccount(request)
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
 * cookie goes then. Without the cookie nothing is asked at all.
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
    if (!isPageVisit(request.method, request.headers))
        return {
            who: UNNAMED,
            write,
        }
    const who = await currentAccount(accounts, fresh.session.accessToken)
    if (who === 'ended') return drop()
    return {
        who: who ?? UNNAMED,
        write,
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
