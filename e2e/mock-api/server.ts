// In-memory implementation of the tailor-api contract (./openapi.json), for
// e2e tests and for working on the frontend without a backend:
//   pnpm mock:api                 # http://localhost:4000
//   PORT=4010 pnpm mock:api
// Test hooks: a company starting with "!fail" answers 500, "!slow" never
// answers (until the caller gives up); POST /__mock/reset restores the seed
// and clears the request log; GET /__mock/requests lists the /api requests
// that arrived since (method, path, headers, body size, aborted). Runs on
// Node's built-in TypeScript support.
//
// The caller: no Authorization is a local visitor (a site without accounts),
// let in. `Bearer <header>.<payload>.<random>` (the unsigned JWT-shaped tokens of
// e2e/mock-id.mjs) is the payload's `sub`; without `tailor` in its `roles` it gets
// 403 FORBIDDEN everywhere but /me. Anything else is a 401. Profiles are kept per user; a PUT is refused for a
// document that is not an object, an unknown section, or a person.email without @.
// GET /api/v1/profile/cv.pdf (the master CV) answers MOCK_PDF for a saved profile.
// POST /api/v1/vacancies/intake adds `pending` applications with no company or role;
// a link already in the list is `existing` (same string, no normalization).
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const statuses = [
    'new',
    'sent',
    'interview',
    'offer',
    'rejected',
] as const
type Application = {
    id: string
    company: string
    role: string
    vacancyUrl: string | null
    vacancyText: string
    status: (typeof statuses)[number]
    vacancyId: string | null
    parseStatus: 'pending' | 'parsed' | 'failed' | null
    createdAt: string
}
type Issue = {
    path: string
    message: string
}
/** One /api request as it arrived, for tests of what the web's proxy forwards. */
type Received = {
    method: string
    path: string
    headers: IncomingMessage['headers']
    bodyBytes?: number
    aborted: boolean
}

const port = Number(process.env.PORT ?? 4000)
const createDelayMs = Number(process.env.MOCK_DELAY_MS ?? 400)
const openapi = readFileSync(new URL('./openapi.json', import.meta.url), 'utf8')

let applications: Application[] = []
let received: Received[] = []
type StoredProfile = {
    version: number
    updatedAt: string
    document: Record<string, unknown>
}
let profiles = new Map<string, StoredProfile>()

/** A minimal one-page PDF: what tailor-api streams for the master CV. */
const MOCK_PDF = Buffer.from(
    [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj',
        'trailer << /Root 1 0 R >>',
        '%%EOF',
        '',
    ].join('\n'),
    'latin1',
)
const MOCK_CV_FILE_NAME = 'Alex-Example-Senior-Engineer-CV.pdf'

const LOCAL_VISITOR = '00000000-0000-7000-8000-000000000000'
const SECTIONS = [
    'person',
    'career',
    'employments',
    'cases',
    'skills',
    'education',
    'languages',
    'summary',
    'story',
    'applicationFacts',
    'answers',
    'voice',
    'settings',
]

type Caller = {
    userId: string
    allowed: boolean
}

/** Who calls, or null for a token the mock does not know. */
function callerOf(req: IncomingMessage): Caller | null {
    const header = req.headers.authorization
    if (!header)
        return {
            userId: LOCAL_VISITOR,
            allowed: true,
        }
    const payload = /^Bearer [\w-]+\.([\w-]+)\.[\w-]+$/.exec(header)?.[1]
    if (!payload) return null
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
            sub?: unknown
            roles?: unknown
        }
        if (typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.sub)) return null
        return {
            userId: claims.sub,
            allowed: Array.isArray(claims.roles) && claims.roles.includes('tailor'),
        }
    } catch {
        return null
    }
}

function profileIssues(document: unknown): Issue[] {
    if (typeof document !== 'object' || document === null || Array.isArray(document))
        return [
            {
                path: '',
                message: 'Invalid input: expected object',
            },
        ]
    const issues: Issue[] = Object.keys(document)
        .filter(key => !SECTIONS.includes(key))
        .map(key => ({
            path: '',
            message: `Unrecognized key: "${key}"`,
        }))
    const email = (
        document as {
            person?: {
                email?: unknown
            }
        }
    ).person?.email
    if (email !== undefined && (typeof email !== 'string' || !email.includes('@')))
        issues.push({
            path: 'person.email',
            message: 'Invalid email address',
        })
    return issues
}

function seed() {
    received = []
    profiles = new Map()
    const start = Date.parse('2026-10-01T09:00:00.000Z')
    applications = Array.from(
        {
            length: 45,
        },
        (_, index) => {
            const n = 45 - index
            return {
                id: `application-${String(n).padStart(3, '0')}`,
                company: `Seed company ${n}`,
                role: n % 4 === 0 ? '' : `Seed role ${n}`,
                vacancyUrl: n % 2 === 0 ? `https://example.com/jobs/${n}` : null,
                vacancyText: n % 3 === 0 ? '' : `Vacancy text of seed application ${n}. Written by the mock API.`,
                status: statuses[n % statuses.length] ?? 'new',
                vacancyId: null,
                parseStatus: null,
                createdAt: new Date(start + n * 3_600_000).toISOString(),
            }
        },
    )
}

const encodeCursor = (id: string) =>
    Buffer.from(
        JSON.stringify({
            after: id,
        }),
    ).toString('base64url')
function decodeCursor(cursor: string): string | undefined {
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        return typeof value?.after === 'string' ? value.after : undefined
    } catch {
        return undefined
    }
}

function send(res: ServerResponse, status: number, body: unknown, requestId: string) {
    res.writeHead(status, {
        'content-type': 'application/json',
        'x-request-id': requestId,
    })
    res.end(body === undefined ? '' : JSON.stringify(body))
}

function fail(
    res: ServerResponse,
    status: number,
    code: string,
    message: string,
    requestId: string,
    details?: Issue[],
) {
    send(
        res,
        status,
        {
            code,
            message,
            ...(details
                ? {
                      details,
                  }
                : {}),
            requestId,
        },
        requestId,
    )
}

async function readJson(req: IncomingMessage, record?: Received): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks)
    if (record) record.bodyBytes = raw.byteLength
    const text = raw.toString('utf8')
    return text ? JSON.parse(text) : undefined
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://mock')
    const incoming = req.headers['x-request-id']
    const requestId = typeof incoming === 'string' && incoming ? incoming : randomUUID()
    const method = req.method ?? 'GET'
    const path = url.pathname

    if (method === 'GET' && (path === '/health/ready' || path === '/health/live')) {
        return send(
            res,
            200,
            {
                status: 'ok',
            },
            requestId,
        )
    }
    if (method === 'GET' && path === '/openapi.json') {
        res.writeHead(200, {
            'content-type': 'application/json',
        })
        return res.end(openapi)
    }
    if (method === 'POST' && path === '/__mock/reset') {
        seed()
        return send(res, 204, undefined, requestId)
    }
    if (method === 'GET' && path === '/__mock/requests') {
        return send(res, 200, received, requestId)
    }

    const record: Received = {
        method,
        path,
        headers: req.headers,
        aborted: false,
    }
    received.push(record)
    if (received.length > 100) received.shift()
    res.on('close', () => {
        if (!res.writableFinished) record.aborted = true
    })

    const who = callerOf(req)
    if (!who) return fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired access token', requestId)
    const caller = who.userId
    if (method === 'GET' && path === '/api/v1/me') {
        return send(
            res,
            200,
            {
                userId: caller,
                allowed: who.allowed,
            },
            requestId,
        )
    }
    if (!who.allowed) return fail(res, 403, 'FORBIDDEN', 'Forbidden', requestId)

    if (method === 'GET' && path === '/api/v1/profile') {
        const profile = profiles.get(caller)
        if (!profile) return fail(res, 404, 'NOT_FOUND', 'Profile not found', requestId)
        return send(res, 200, profile, requestId)
    }
    if (method === 'GET' && path === '/api/v1/profile/cv.pdf') {
        if (!profiles.has(caller)) return fail(res, 404, 'NOT_FOUND', 'Profile not found', requestId)
        res.writeHead(200, {
            'content-type': 'application/pdf',
            'content-disposition': `inline; filename="${MOCK_CV_FILE_NAME}"`,
            'content-length': String(MOCK_PDF.length),
            'cache-control': 'private, no-store',
            'x-request-id': requestId,
        })
        return res.end(MOCK_PDF)
    }
    if (method === 'PUT' && path === '/api/v1/profile') {
        let document: unknown
        try {
            document = await readJson(req, record)
        } catch {
            return fail(res, 400, 'VALIDATION_FAILED', 'Body is not JSON', requestId, [])
        }
        const issues = profileIssues(document)
        if (issues.length > 0)
            return fail(res, 400, 'VALIDATION_FAILED', 'Request validation failed', requestId, issues)
        const profile: StoredProfile = {
            version: (profiles.get(caller)?.version ?? 0) + 1,
            updatedAt: new Date().toISOString(),
            document: {
                ...Object.fromEntries(
                    SECTIONS.map(section => [
                        section,
                        {},
                    ]),
                ),
                ...(document as Record<string, unknown>),
            },
        }
        profiles.set(caller, profile)
        return send(
            res,
            200,
            {
                version: profile.version,
                sha256: '0'.repeat(64),
                updatedAt: profile.updatedAt,
            },
            requestId,
        )
    }

    if (method === 'GET' && path === '/api/v1/applications') {
        const limit = Number(url.searchParams.get('limit') ?? 20)
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return fail(res, 400, 'VALIDATION_FAILED', 'Invalid query', requestId, [
                {
                    path: 'limit',
                    message: 'limit must be an integer from 1 to 100',
                },
            ])
        }
        const cursor = url.searchParams.get('cursor')
        let start = 0
        if (cursor) {
            const after = decodeCursor(cursor)
            const index = applications.findIndex(application => application.id === after)
            if (index < 0) {
                return fail(res, 400, 'VALIDATION_FAILED', 'Invalid cursor', requestId, [
                    {
                        path: 'cursor',
                        message: 'cursor is not valid',
                    },
                ])
            }
            start = index + 1
        }
        const items = applications.slice(start, start + limit)
        const last = items.at(-1)
        const nextCursor = last && start + limit < applications.length ? encodeCursor(last.id) : null
        return send(
            res,
            200,
            {
                items,
                nextCursor,
            },
            requestId,
        )
    }

    const detail = path.match(/^\/api\/v1\/applications\/([^/]+)$/)
    if (method === 'GET' && detail) {
        const id = decodeURIComponent(detail[1] ?? '')
        const application = applications.find(item => item.id === id)
        if (!application) return fail(res, 404, 'NOT_FOUND', `Application ${id} not found`, requestId)
        return send(res, 200, application, requestId)
    }

    if (method === 'POST' && path === '/api/v1/applications') {
        let input: unknown
        try {
            input = await readJson(req, record)
        } catch {
            return fail(res, 400, 'VALIDATION_FAILED', 'Body is not JSON', requestId, [])
        }
        const {
            company,
            role = '',
            vacancyUrl,
            vacancyText = '',
        } = (input ?? {}) as {
            company?: unknown
            role?: unknown
            vacancyUrl?: unknown
            vacancyText?: unknown
        }
        const issues: Issue[] = []
        if (typeof company !== 'string' || company.trim().length < 1 || company.length > 200) {
            issues.push({
                path: 'company',
                message: 'company must be 1 to 200 characters',
            })
        }
        if (typeof role !== 'string' || role.length > 200) {
            issues.push({
                path: 'role',
                message: 'role must be at most 200 characters',
            })
        }
        if (vacancyUrl !== undefined && (typeof vacancyUrl !== 'string' || !/^https?:\/\//.test(vacancyUrl))) {
            issues.push({
                path: 'vacancyUrl',
                message: 'vacancyUrl must be an http(s) URL',
            })
        }
        if (typeof vacancyText !== 'string' || vacancyText.length > 50_000) {
            issues.push({
                path: 'vacancyText',
                message: 'vacancyText must be at most 50000 characters',
            })
        }
        if (typeof company === 'string' && company.startsWith('!slow')) {
            // Holds the request until the caller gives up (at most a minute).
            await Promise.race([
                new Promise(resolve => res.once('close', resolve)),
                sleep(60_000),
            ])
            if (!res.destroyed) fail(res, 500, 'INTERNAL', 'Mock gave up waiting', requestId)
            return
        }
        await sleep(createDelayMs)
        if (issues.length > 0) {
            return fail(res, 400, 'VALIDATION_FAILED', 'Validation failed', requestId, issues)
        }
        if ((company as string).startsWith('!fail')) {
            return fail(res, 500, 'INTERNAL', 'Mock failure', requestId)
        }
        const application: Application = {
            id: randomUUID(),
            company: (company as string).trim(),
            role: (role as string).trim(),
            vacancyUrl: (vacancyUrl as string | undefined) ?? null,
            vacancyText: vacancyText as string,
            status: 'new',
            vacancyId: null,
            parseStatus: null,
            createdAt: new Date().toISOString(),
        }
        applications = [
            application,
            ...applications,
        ]
        return send(res, 201, application, requestId)
    }

    if (method === 'POST' && path === '/api/v1/vacancies/intake') {
        let input: unknown
        try {
            input = await readJson(req, record)
        } catch {
            return fail(res, 400, 'VALIDATION_FAILED', 'Body is not JSON', requestId, [])
        }
        const items = (
            input as
                | {
                      items?: unknown
                  }
                | undefined
        )?.items
        if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
            return fail(res, 400, 'VALIDATION_FAILED', 'Request validation failed', requestId, [
                {
                    path: 'items',
                    message: 'Expected 1 to 200 items',
                },
            ])
        }
        const issues: Issue[] = []
        const parsed = items.map((item: unknown, index) => {
            const { url, text = '' } = (item ?? {}) as {
                url?: unknown
                text?: unknown
            }
            if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url) || url.length > 2048))
                issues.push({
                    path: `items.${index}.url`,
                    message: 'Invalid URL',
                })
            if (typeof text !== 'string' || text.length > 100_000)
                issues.push({
                    path: `items.${index}.text`,
                    message: 'Too big: expected string to have <=100000 characters',
                })
            else if (url === undefined && !text.trim())
                issues.push({
                    path: `items.${index}`,
                    message: 'A vacancy needs a link or its text',
                })
            return {
                url: url as string | undefined,
                text: typeof text === 'string' ? text.trim() : '',
            }
        })
        await sleep(createDelayMs)
        if (issues.length > 0)
            return fail(res, 400, 'VALIDATION_FAILED', 'Request validation failed', requestId, issues)
        const results = parsed.map(({ url, text }) => {
            const found = url === undefined ? undefined : applications.find(item => item.vacancyUrl === url)
            if (found)
                return {
                    applicationId: found.id,
                    vacancyId: found.vacancyId ?? randomUUID(),
                    result: 'existing' as const,
                }
            const application: Application = {
                id: randomUUID(),
                company: '',
                role: '',
                vacancyUrl: url ?? null,
                vacancyText: text,
                status: 'new',
                vacancyId: randomUUID(),
                parseStatus: 'pending',
                createdAt: new Date().toISOString(),
            }
            applications = [
                application,
                ...applications,
            ]
            return {
                applicationId: application.id,
                vacancyId: application.vacancyId as string,
                result: 'created' as const,
            }
        })
        const created = results.filter(item => item.result === 'created').length
        return send(
            res,
            200,
            {
                created,
                existing: results.length - created,
                items: results,
            },
            requestId,
        )
    }

    return fail(res, 404, 'NOT_FOUND', `No route ${method} ${path}`, requestId)
}

seed()
createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
        console.error(error)
        if (!res.headersSent) fail(res, 500, 'INTERNAL', 'Mock crashed', randomUUID())
    })
}).listen(port, () => {
    console.log(`mock API on http://localhost:${port}`)
})
