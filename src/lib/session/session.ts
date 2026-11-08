import 'server-only'
import { z } from 'zod'
import { consentDomain } from '@/lib/analytics/consent'
import { serverEnv } from '@/lib/env/server'
import { seal, unseal } from './seal'

/**
 * The session of the account (copied from landing-web): one sealed cookie on the
 * whole domain, under the secret every site shares. Sign-in happens at id-web; this
 * site reads the cookie, keeps its token fresh, asks id-api who the person is and
 * sends the access token to tailor-api. Tokens never reach the browser's JavaScript.
 * Null while the site has no accounts (ID_URL, ID_API_URL or SESSION_SECRET unset).
 */
export const accounts =
    serverEnv.ID_URL && serverEnv.ID_API_URL && serverEnv.SESSION_SECRET
        ? {
              idUrl: serverEnv.ID_URL,
              idApiUrl: serverEnv.ID_API_URL,
              secret: serverEnv.SESSION_SECRET,
          }
        : null
export type Accounts = NonNullable<typeof accounts>

/** The person, as the header shows them; empty when id-api could not say in time. */
export type Account = {
    name: string | null
    email: string | null
}

export type Session = {
    accessToken: string
    /** ms since epoch */
    accessExpiresAt: number
    refreshToken: string
    sessionId: string
}

export const SESSION_MAX_AGE = 30 * 86_400
/** Refresh when less than this is left of the access token. */
export const REFRESH_BEFORE_MS = 60_000
/**
 * Set by the proxy for the layout: the person of this request, as JSON. Saves the
 * layout a second call to id-api. The proxy removes what a browser sends, except where
 * it does not run (/api/*): a page rendered there shows the sender only their own
 * words, so the layout reads the header as untrusted.
 */
export const ACCOUNT_HEADER = 'x-nl-account'
const accountSchema = z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
})

export const accountHeader = (account: Account) => encodeURIComponent(JSON.stringify(account))

/** Who the header names; null when nobody, or when it is not what the proxy writes. */
export function accountFromHeader(value: string | null): Account | null {
    if (!value) return null
    try {
        return accountSchema.parse(JSON.parse(decodeURIComponent(value)))
    } catch {
        return null
    }
}

/**
 * A refresh is waited for as long as id-api may still turn the token (8 s,
 * ROTATE_DEADLINE_MS): a token turned after this site gave up is lost, and the next
 * request has to turn the old one again.
 */
const REFRESH_TIMEOUT_MS = 10_000
/** A name is not worth holding a page for: past this the header says "Account". */
const ACCOUNT_TIMEOUT_MS = 1_000

const secure = () => serverEnv.SITE_URL.startsWith('https://')

/** `__Secure-` needs Secure, so plain-http local runs use the bare name. */
export const cookieName = () => (secure() ? '__Secure-nl_session' : 'nl_session')

/** On the registered domain, as id-web sets it; no Domain on localhost or an IP. */
export const sessionCookieOptions = (maxAge: number) => {
    const domain = consentDomain(serverEnv.SITE_URL)
    return {
        httpOnly: true,
        secure: secure(),
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
        ...(domain
            ? {
                  domain,
              }
            : {}),
    }
}

/** A browser only expires a cookie with the Domain and Secure it was set with. */
export const expiredSessionCookie = () => sessionCookieOptions(0)

export const sealSession = (config: Accounts, session: Session) => seal(session, config.secret, 'session')
export const openSession = (config: Accounts, value: string | undefined) =>
    unseal<Session>(value, config.secret, 'session')

/** One call to id-api: JSON in and out. `undefined` when it could not be asked in time. */
async function idApi<T>(
    config: Accounts,
    path: string,
    options: {
        method?: 'GET' | 'POST'
        token?: string
        body?: unknown
        timeoutMs: number
    },
): Promise<
    | {
          status: number
          data: T | undefined
      }
    | undefined
> {
    try {
        const response = await fetch(`${config.idApiUrl}${path}`, {
            method: options.method ?? 'GET',
            headers: {
                accept: 'application/json',
                ...(options.body === undefined
                    ? {}
                    : {
                          'content-type': 'application/json',
                      }),
                ...(options.token
                    ? {
                          authorization: `Bearer ${options.token}`,
                      }
                    : {}),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: AbortSignal.timeout(options.timeoutMs),
            cache: 'no-store',
        })
        const text = await response.text()
        return {
            status: response.status,
            data: response.ok && text ? (JSON.parse(text) as T) : undefined,
        }
    } catch {
        return undefined
    }
}

/** New tokens. `ended`: id-api refused the token; `unavailable`: keep the cookie and try on a later page. */
export async function refreshSession(config: Accounts, session: Session): Promise<Session | 'ended' | 'unavailable'> {
    const tokens = await idApi<{
        accessToken: string
        accessExpiresAt: string
        refreshToken: string
        sessionId: string
    }>(config, '/api/v1/sessions/refresh', {
        method: 'POST',
        body: {
            refreshToken: session.refreshToken,
        },
        timeoutMs: REFRESH_TIMEOUT_MS,
    })
    if (tokens?.status === 401 || tokens?.status === 400) return 'ended'
    if (!tokens?.data) return 'unavailable'
    return {
        accessToken: tokens.data.accessToken,
        accessExpiresAt: Date.parse(tokens.data.accessExpiresAt),
        refreshToken: tokens.data.refreshToken,
        sessionId: tokens.data.sessionId,
    }
}

/**
 * Who the person is, and in one call whether the session still lives: the token alone
 * stays valid after it ended. `ended` only when id-api says so; undefined on anything
 * else, and the page goes on without a name.
 */
export async function currentAccount(config: Accounts, accessToken: string): Promise<Account | 'ended' | undefined> {
    const me = await idApi<{
        email: string
        displayName: string | null
        active?: boolean | null
    }>(config, '/api/v1/me', {
        token: accessToken,
        timeoutMs: ACCOUNT_TIMEOUT_MS,
    })
    if (!me?.data) return undefined
    if (me.data.active === false) return 'ended'
    return {
        name: me.data.displayName,
        email: me.data.email,
    }
}

/**
 * The session with an access token good for at least REFRESH_BEFORE_MS more: refreshed
 * when it is about to expire. `ended`: id-api refused the refresh, the cookie goes. When
 * id-api does not answer, the old tokens stay and the API answers 401 if they are dead.
 */
export async function keepFresh(
    config: Accounts,
    session: Session,
): Promise<
    | {
          session: Session
          refreshed: boolean
      }
    | 'ended'
> {
    if (session.accessExpiresAt - Date.now() >= REFRESH_BEFORE_MS)
        return {
            session,
            refreshed: false,
        }
    const refreshed = await refreshSession(config, session)
    if (refreshed === 'ended') return 'ended'
    if (refreshed === 'unavailable')
        return {
            session,
            refreshed: false,
        }
    return {
        session: refreshed,
        refreshed: true,
    }
}

/** Ends the session at id-api. False when it could not: the person is told, and stays signed in. */
export async function endSession(config: Accounts, session: Session) {
    const ended = await idApi(config, '/api/v1/sessions/logout', {
        method: 'POST',
        body: {
            refreshToken: session.refreshToken,
        },
        timeoutMs: REFRESH_TIMEOUT_MS,
    })
    return ended !== undefined && ended.status < 500
}

/**
 * A person opening a page, as opposed to anything a page or the browser fetches by
 * itself: a GET for a top-level document (Fetch Metadata, or an HTML Accept without
 * it); no prefetch or prerender, frame, script or the router's fetch.
 */
export function isPageVisit(
    method: string,
    headers: {
        get(name: string): string | null
    },
) {
    if (method !== 'GET') return false
    if (headers.get('sec-purpose') !== null || headers.get('purpose') !== null) return false
    const mode = headers.get('sec-fetch-mode')
    const dest = headers.get('sec-fetch-dest')
    if (mode !== null || dest !== null) return mode === 'navigate' && dest === 'document'
    return (headers.get('accept') ?? '').includes('text/html')
}
