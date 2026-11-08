import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SECRET = 'test-session-secret-0123456789abcdef'

/** The module of a site served at `siteUrl`, with accounts on (env is read on import). */
async function load(siteUrl = 'https://tailor.nick-lukashik.com') {
    vi.resetModules()
    vi.stubEnv('SITE_URL', siteUrl)
    vi.stubEnv('ID_URL', 'https://id.nick-lukashik.com')
    vi.stubEnv('ID_API_URL', 'http://id-api.test')
    vi.stubEnv('SESSION_SECRET', SECRET)
    const session = await import('./session')
    if (!session.accounts) throw new Error('accounts are off')
    return {
        ...session,
        config: session.accounts,
    }
}

const session = {
    accessToken: 'at.old',
    accessExpiresAt: Date.parse('2026-11-05T10:00:00Z'),
    refreshToken: 'sid.old',
    sessionId: 'sid',
}

/** id-api answers `status` with `body`, and the calls can be read back. */
function idApi(status: number, body?: unknown) {
    const fetchMock = vi.fn(
        async () =>
            new Response(body === undefined ? null : JSON.stringify(body), {
                status,
            }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('the session cookie', () => {
    it('goes to every site under the domain, and expires with the same Domain', async () => {
        const { cookieName, expiredSessionCookie, sessionCookieOptions } = await load()
        expect(cookieName()).toBe('__Secure-nl_session')
        expect(sessionCookieOptions(60)).toEqual({
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 60,
            domain: 'nick-lukashik.com',
        })
        expect(expiredSessionCookie()).toMatchObject({
            domain: 'nick-lukashik.com',
            maxAge: 0,
        })
    })

    it('has no Domain on localhost, where the port does not matter to a cookie', async () => {
        const { cookieName, sessionCookieOptions } = await load('http://localhost:3000')
        expect(cookieName()).toBe('nl_session')
        expect(sessionCookieOptions(60)).not.toHaveProperty('domain')
    })

    it('opens what it sealed, and nothing sealed for another purpose or under another key', async () => {
        const { config, openSession, sealSession } = await load()
        expect(openSession(config, sealSession(config, session))).toEqual(session)
        expect(openSession(config, 'does-not-open')).toBeUndefined()
        expect(
            openSession(
                {
                    ...config,
                    secret: 'another-session-secret-0123456789abc',
                },
                sealSession(config, session),
            ),
        ).toBeUndefined()
    })
})

describe('the account header', () => {
    it('reads back what the proxy writes', async () => {
        const { accountFromHeader, accountHeader } = await load()
        const account = {
            name: 'Имя; "с" кавычками',
            email: null,
        }
        expect(accountFromHeader(accountHeader(account))).toEqual(account)
    })

    it('is nobody when it is not what the proxy writes', async () => {
        const { accountFromHeader } = await load()
        for (const value of [
            null,
            '',
            '%',
            'not-json',
            encodeURIComponent('{"name":{"a":1},"email":null}'),
            encodeURIComponent('[]'),
        ])
            expect(accountFromHeader(value)).toBeNull()
    })
})

describe('refreshSession', () => {
    it('gives the new tokens', async () => {
        const { config, refreshSession } = await load()
        idApi(200, {
            accessToken: 'at.new',
            accessExpiresAt: '2026-11-05T10:05:00Z',
            refreshToken: 'sid.new',
            sessionId: 'sid',
        })
        expect(await refreshSession(config, session)).toEqual({
            accessToken: 'at.new',
            accessExpiresAt: Date.parse('2026-11-05T10:05:00Z'),
            refreshToken: 'sid.new',
            sessionId: 'sid',
        })
    })

    it('tells a refusal from id-api not answering: only a refusal ends the session', async () => {
        const { config, refreshSession } = await load()
        idApi(401)
        expect(await refreshSession(config, session)).toBe('ended')
        idApi(503)
        expect(await refreshSession(config, session)).toBe('unavailable')
        idApi(429)
        expect(await refreshSession(config, session)).toBe('unavailable')
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
        expect(await refreshSession(config, session)).toBe('unavailable')
    })
})

describe('keepFresh', () => {
    it('leaves a token with time left alone and asks nothing', async () => {
        const { config, keepFresh } = await load()
        const fetchMock = idApi(500)
        const fresh = {
            ...session,
            accessExpiresAt: Date.now() + 120_000,
        }
        expect(await keepFresh(config, fresh)).toEqual({
            session: fresh,
            refreshed: false,
        })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refreshes a token about to expire, keeps it when id-api does not answer, ends on a refusal', async () => {
        const { config, keepFresh } = await load()
        idApi(200, {
            accessToken: 'at.new',
            accessExpiresAt: '2026-11-05T10:05:00Z',
            refreshToken: 'sid.new',
            sessionId: 'sid',
        })
        expect(await keepFresh(config, session)).toMatchObject({
            session: {
                accessToken: 'at.new',
            },
            refreshed: true,
        })
        idApi(503)
        expect(await keepFresh(config, session)).toEqual({
            session,
            refreshed: false,
        })
        idApi(401)
        expect(await keepFresh(config, session)).toBe('ended')
    })
})

describe('currentAccount', () => {
    const me = {
        email: 'person@example.com',
        displayName: 'Person',
    }

    it('says who it is, also while id-api does not know yet whether the session stands', async () => {
        const { config, currentAccount } = await load()
        for (const active of [
            true,
            null,
            undefined,
        ]) {
            idApi(200, {
                ...me,
                active,
            })
            expect(await currentAccount(config, 'at')).toEqual({
                name: 'Person',
                email: 'person@example.com',
            })
        }
    })

    it('ends only when id-api says so', async () => {
        const { config, currentAccount } = await load()
        idApi(200, {
            ...me,
            active: false,
        })
        expect(await currentAccount(config, 'at')).toBe('ended')
        idApi(401)
        expect(await currentAccount(config, 'at')).toBeUndefined()
        idApi(503)
        expect(await currentAccount(config, 'at')).toBeUndefined()
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
        expect(await currentAccount(config, 'at')).toBeUndefined()
    })
})

describe('endSession', () => {
    it('is false only when id-api could not end it', async () => {
        const { config, endSession } = await load()
        idApi(204)
        expect(await endSession(config, session)).toBe(true)
        idApi(401)
        expect(await endSession(config, session)).toBe(true)
        idApi(503)
        expect(await endSession(config, session)).toBe(false)
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
        expect(await endSession(config, session)).toBe(false)
    })
})

describe('isPageVisit', () => {
    const page = {
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
    }

    it('is a person opening a page', async () => {
        const { isPageVisit } = await load()
        expect(isPageVisit('GET', new Headers(page))).toBe(true)
        // A client without Fetch Metadata.
        expect(
            isPageVisit(
                'GET',
                new Headers({
                    accept: 'text/html',
                }),
            ),
        ).toBe(true)
    })

    it('is not a prefetch, a router fetch, a frame or a POST', async () => {
        const { isPageVisit } = await load()
        for (const headers of [
            {
                ...page,
                'sec-purpose': 'prefetch',
            },
            {
                ...page,
                purpose: 'prefetch',
            },
            // A router fetch: the proxy never sees its `rsc` header, Next.js takes it off first.
            {
                'sec-fetch-mode': 'cors',
                'sec-fetch-dest': 'empty',
            },
            {
                'sec-fetch-mode': 'navigate',
                'sec-fetch-dest': 'iframe',
            },
        ])
            expect(isPageVisit('GET', new Headers(headers))).toBe(false)
        expect(isPageVisit('POST', new Headers(page))).toBe(false)
    })
})
