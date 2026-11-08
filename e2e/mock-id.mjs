// The account site for the sign-in tests, in memory: id-web's /login, which seals
// the session cookie every site shares, and the id-api calls this site makes (me,
// sessions/refresh, sessions/logout). None of their rules beyond what the tests need.
// /login signs in as the email of the `e2e_email` cookie the test sets. Cookies do
// not care about ports, so the one it sets reaches the site as it would across
// subdomains. Emails starting with `short-` get 30 s tokens (under the site's 60 s
// refresh margin), `down-` a 503 from me, `fail-` a 503 from logout, `named-` a
// name, `guest-` no `tailor` role. Access tokens are shaped like id-api's JWTs but not
// signed: `<header>.<payload>.<random>`, the payload `{ sub, sid, roles, exp }`; the site
// reads `roles`, the mock API `sub` and `roles`. /landing stands for the platform's
// landing (HOME_URL of the site). /test/* lets a test look.
// (landing-web's mock, with user ids and roles in the tokens.)
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 3290)
const SECRET = process.env.SESSION_SECRET ?? ''
const sessions = new Map() // sessionId -> { email, refreshToken, previous, revoked, me, refreshes }
const tokens = new Map() // accessToken -> sessionId

/** As src/lib/session/seal.ts. */
function seal(value) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(SECRET).digest(), iv)
    cipher.setAAD(Buffer.from('session'))
    const body = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
    ])
    return Buffer.concat([
        iv,
        cipher.getAuthTag(),
        body,
    ]).toString('base64url')
}

/** A stable user id per email, as a uuid. */
function userIdOf(email) {
    const hex = createHash('sha256').update(email).digest('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')

/** What id-api would put in the token: the `tailor` role for everyone but `guest-`. */
function accessTokenOf(email, sessionId, expiresAt) {
    return [
        part({
            alg: 'none',
            typ: 'at+jwt',
        }),
        part({
            sub: userIdOf(email),
            sid: sessionId,
            roles: email.startsWith('guest-')
                ? []
                : [
                      'tailor',
                  ],
            exp: Math.floor(expiresAt / 1000),
        }),
        randomBytes(12).toString('base64url'),
    ].join('.')
}

function issue(sessionId) {
    const session = sessions.get(sessionId)
    const expiresAt = Date.now() + (session.email.startsWith('short-') ? 30_000 : 300_000)
    const accessToken = accessTokenOf(session.email, sessionId, expiresAt)
    session.refreshToken = `${sessionId}.${randomBytes(24).toString('base64url')}`
    tokens.set(accessToken, sessionId)
    session.issued = [
        ...(session.issued ?? []),
        accessToken,
    ]
    return {
        accessToken,
        accessExpiresAt: new Date(expiresAt).toISOString(),
        refreshToken: session.refreshToken,
        sessionId,
    }
}

const json = (response, status, body) => {
    response.writeHead(status, {
        'content-type': 'application/json',
    })
    response.end(body === undefined ? undefined : JSON.stringify(body))
}

createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString()
    const body = text ? JSON.parse(text) : {}
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)

    if (url.pathname === '/health')
        return json(response, 200, {
            status: 'ok',
        })
    // The platform's landing, as far as the tests care: where the site sends anyone without access.
    if (url.pathname === '/landing') {
        response.writeHead(200, {
            'content-type': 'text/html',
        })
        return response.end('<!doctype html><title>Landing</title>')
    }
    if (url.pathname === '/login') {
        const email = decodeURIComponent(/(?:^|;\s*)e2e_email=([^;]+)/.exec(request.headers.cookie ?? '')?.[1] ?? '')
        const sessionId = randomUUID()
        sessions.set(sessionId, {
            email,
            revoked: false,
            me: 0,
            refreshes: 0,
        })
        const issued = issue(sessionId)
        response.writeHead(303, {
            location: url.searchParams.get('continue') ?? '/',
            'set-cookie': `nl_session=${seal({
                ...issued,
                accessExpiresAt: Date.parse(issued.accessExpiresAt),
            })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        })
        return response.end()
    }
    // As id-api: the token of an ended session still works here, and the answer tells it ended.
    if (url.pathname === '/api/v1/me') {
        const session = sessions.get(tokens.get(request.headers.authorization?.replace(/^Bearer /, '')))
        if (!session)
            return json(response, 401, {
                code: 'UNAUTHORIZED',
            })
        session.me += 1
        if (session.email.startsWith('down-'))
            return json(response, 503, {
                code: 'UNAVAILABLE',
            })
        return json(response, 200, {
            email: session.email,
            displayName: session.email.startsWith('named-') ? 'Named Person' : null,
            active: !session.revoked,
        })
    }
    if (url.pathname === '/api/v1/sessions/refresh' && request.method === 'POST') {
        const sessionId = String(body.refreshToken).split('.')[0]
        const session = sessions.get(sessionId)
        // As id-api: the token turned just before gets the same answer for 20 s (parallel requests of a page).
        if (
            session
            && !session.revoked
            && session.previous?.token === body.refreshToken
            && Date.now() - session.previous.at < 20_000
        )
            return json(response, 200, session.previous.issued)
        if (!session || session.revoked || session.refreshToken !== body.refreshToken)
            return json(response, 401, {
                code: 'UNAUTHORIZED',
            })
        session.refreshes += 1
        const turned = session.refreshToken
        const issued = issue(sessionId)
        session.previous = {
            token: turned,
            issued,
            at: Date.now(),
        }
        return json(response, 200, issued)
    }
    if (url.pathname === '/api/v1/sessions/logout' && request.method === 'POST') {
        const session = sessions.get(String(body.refreshToken).split('.')[0])
        if (session?.email.startsWith('fail-'))
            return json(response, 503, {
                code: 'UNAVAILABLE',
            })
        if (session) session.revoked = true
        return json(response, 204)
    }
    if (url.pathname === '/test/sessions') {
        const own = [
            ...sessions.values(),
        ].filter(session => session.email === url.searchParams.get('email'))
        return json(response, 200, {
            userId: userIdOf(url.searchParams.get('email') ?? ''),
            live: own.filter(session => !session.revoked).length,
            me: own.reduce((sum, session) => sum + session.me, 0),
            issued: own.flatMap(session => session.issued ?? []),
            refreshes: own.reduce((sum, session) => sum + session.refreshes, 0),
        })
    }
    if (url.pathname === '/test/revoke' && request.method === 'POST') {
        for (const session of sessions.values()) if (session.email === body.email) session.revoked = true
        return json(response, 204)
    }
    return json(response, 404, {
        code: 'NOT_FOUND',
    })
}).listen(PORT, '127.0.0.1')
