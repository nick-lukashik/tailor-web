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
// a link already in the list is `existing` (same string, no normalization). Their
// vacancies stay `pending` until POST /__mock/vacancies/<id> {"parseStatus": "parsed"
// | "failed", "parseError"?} settles one. POST /api/v1/vacancies/<id>/parse (202)
// reads one again: after MOCK_PARSE_MS it is `failed` with `no_text` without a
// text, else `parsed`. GET /api/v1/applications/<id> adds the vacancy and `cv`;
// list rows carry `cvStatus`. A parse (the reparse or the settle hook) queues CV
// version 1 for its applications without one, as tailor-api does; POST
// /api/v1/applications/<id>/cv (202) queues the next (409 while one is queued or
// generating, or the vacancy is not parsed). A version is `generating` after
// MOCK_CV_MS and `ready` with a cv.example.com link after as long again. A ready
// CV queues the next materials version (the texts for applying by hand), as
// tailor-api does; POST /api/v1/applications/<id>/materials (202) queues one (409
// without a ready CV or while one is queued or generating); it goes the same
// way as a CV. POST /__mock/applications/<id>/materials {"status": "failed",
// "error"?} fails the newest one. PATCH /api/v1/applications/<id> {"status"} sets
// the status. List rows carry `materialsStatus`, the detail `materials`. Seed:
// application-040 (on the first page) is ready to send (status new, CV and
// materials ready), 010 is
// parsed (no CV yet), 009 failed with no text, 008 pending, 007 failed with a text.
// A vacancy with a link is `fetched` (040 with MOCK_FORM, its answers in the
// materials), without one `skipped`; 012 is parsed but its page `failed`.
// POST /api/v1/vacancies/<id>/fetch (202, 409 without a link) reads the link
// again: after MOCK_PARSE_MS it is `fetched` with MOCK_FORM.
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
type ParsedVacancy = {
    title: string | null
    company: string | null
    companyDescription: string | null
    seniority: string | null
    location: string | null
    remote: 'remote' | 'hybrid' | 'onsite' | 'unknown'
    regions: string[]
    employmentType: 'full-time' | 'part-time' | 'contract' | 'freelance' | 'internship' | 'temporary' | null
    salary: {
        min: number | null
        max: number | null
        currency: string | null
        period: 'hour' | 'day' | 'week' | 'month' | 'year' | null
    } | null
    language: string | null
    skills: {
        name: string
        required: boolean
    }[]
    requirements: string[]
    responsibilities: string[]
    niceToHave: string[]
    applyChannels: {
        kind: 'form' | 'email' | 'telegram' | 'link' | 'other'
        value: string
    }[]
    summary: string
    warnings: string[]
}
type CvVersion = {
    version: number
    status: 'queued' | 'generating' | 'ready' | 'failed'
    model: string | null
    error: string | null
    pages: number | null
    fileName: string | null
    updatedAt: string
}
type MaterialsContent = {
    language: 'en' | 'ru'
    coverLetter: string
    emailSubject: string
    emailBody: string
    telegramMessage: string
    linkedinNote: string
    whyMe: string[]
    answers: {
        key: string
        label: string
        answer: string
    }[]
}
type MaterialsVersion = {
    version: number
    status: 'queued' | 'generating' | 'ready' | 'failed'
    error: string | null
    content: MaterialsContent | null
    updatedAt: string
}
type Vacancy = {
    id: string
    url: string | null
    rawText: string
    parseStatus: 'pending' | 'parsed' | 'failed'
    parseError: string | null
    updatedAt: string
    model: string | null
    parsed: ParsedVacancy | null
    applyForm: ApplyForm | null
    fetchStatus: 'pending' | 'fetched' | 'failed' | 'skipped'
    fetchError: string | null
}
type ApplyField = {
    key: string
    label: string
    type: 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean' | 'file' | 'other'
    required: boolean
    options?: string[]
}
type ApplyForm = {
    source: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'page'
    fields: ApplyField[]
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
const parseDelayMs = Number(process.env.MOCK_PARSE_MS ?? 300)
const cvStepMs = Number(process.env.MOCK_CV_MS ?? 300)
const CV_PUBLIC_URL = 'https://cv.example.com'
const MOCK_MODEL = 'mock-model'
const openapi = readFileSync(new URL('./openapi.json', import.meta.url), 'utf8')

let applications: Application[] = []
let vacancies = new Map<string, Vacancy>()
/** CV versions per application, oldest first. */
let cvs = new Map<string, CvVersion[]>()
/** Materials versions per application, oldest first. */
let materials = new Map<string, MaterialsVersion[]>()
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

/** The apply form the mock "reads" from a vacancy page, and what its answers say. */
const MOCK_FORM: ApplyForm = {
    source: 'greenhouse',
    fields: [
        {
            key: 'first_name',
            label: 'First name',
            type: 'text',
            required: true,
        },
        {
            key: 'resume',
            label: 'Resume/CV',
            type: 'file',
            required: true,
        },
        {
            key: 'question_101',
            label: 'Why do you want to join us?',
            type: 'textarea',
            required: false,
        },
        {
            key: 'question_102',
            label: 'Are you authorized to work in Germany?',
            type: 'select',
            required: true,
            options: [
                'Yes',
                'No',
            ],
        },
        {
            key: 'question_103',
            label: 'Desired start date',
            type: 'text',
            required: false,
        },
    ],
}
const MOCK_ANSWERS: Record<string, string> = {
    first_name: 'Alex',
    question_101: 'I build TypeScript APIs and would like to work on your platform.',
    question_102: 'Yes',
    question_103: '',
}

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

/** What the mock "reads" from any vacancy text. */
function parsedOf(company: string, title: string): ParsedVacancy {
    return {
        title,
        company,
        companyDescription: 'A product company of the mock API.',
        seniority: 'senior',
        location: 'Berlin, Germany',
        remote: 'hybrid',
        regions: [
            'EU',
            'UTC+0 to UTC+3',
        ],
        employmentType: 'full-time',
        salary: {
            min: 60_000,
            max: 80_000,
            currency: 'EUR',
            period: 'year',
        },
        language: 'en',
        skills: [
            {
                name: 'TypeScript',
                required: true,
            },
            {
                name: 'PostgreSQL',
                required: true,
            },
            {
                name: 'Kubernetes',
                required: false,
            },
        ],
        requirements: [
            'Five years of backend work',
            'Written English',
        ],
        responsibilities: [
            'Build and run the API',
        ],
        niceToHave: [],
        applyChannels: [
            {
                kind: 'email',
                value: 'jobs@example.com',
            },
            {
                kind: 'telegram',
                value: '@example_jobs',
            },
            {
                kind: 'form',
                value: 'https://jobs.example.com/apply',
            },
        ],
        summary: `${title} at ${company}: backend in TypeScript, hybrid in Berlin.`,
        warnings: [],
    }
}

/** Settles a vacancy as the parse job would. */
function settle(vacancy: Vacancy, parseStatus: 'parsed' | 'failed', parseError: string | null = null) {
    vacancy.parseStatus = parseStatus
    vacancy.parseError = parseStatus === 'failed' ? (parseError ?? 'model_error') : null
    vacancy.parsed = parseStatus === 'parsed' ? parsedOf('Example GmbH', 'Senior backend engineer') : null
    vacancy.model = parseStatus === 'parsed' ? MOCK_MODEL : null
    vacancy.updatedAt = new Date().toISOString()
}

function newVacancy(url: string | null, rawText: string): Vacancy {
    const vacancy: Vacancy = {
        id: randomUUID(),
        url,
        rawText,
        parseStatus: 'pending',
        parseError: null,
        updatedAt: new Date().toISOString(),
        model: null,
        parsed: null,
        applyForm: null,
        fetchStatus: url ? 'fetched' : 'skipped',
        fetchError: null,
    }
    vacancies.set(vacancy.id, vacancy)
    return vacancy
}

/** Queues a new CV version; as the job would, it is `generating`, then `ready`. */
function queueCv(applicationId: string): CvVersion {
    const versions = cvs.get(applicationId) ?? []
    const cv: CvVersion = {
        version: versions.length + 1,
        status: 'queued',
        model: null,
        error: null,
        pages: null,
        fileName: null,
        updatedAt: new Date().toISOString(),
    }
    cvs.set(applicationId, [
        ...versions,
        cv,
    ])
    setTimeout(() => {
        if (cv.status !== 'queued') return
        cv.status = 'generating'
        cv.model = MOCK_MODEL
        cv.updatedAt = new Date().toISOString()
        setTimeout(() => {
            if (cv.status !== 'generating') return
            cv.status = 'ready'
            cv.pages = 2
            cv.fileName = MOCK_CV_FILE_NAME
            cv.updatedAt = new Date().toISOString()
            queueMaterials(applicationId)
        }, cvStepMs)
    }, cvStepMs)
    return cv
}

function cvUrlOf(applicationId: string): string | null {
    const ready = cvs.get(applicationId)?.findLast(version => version.status === 'ready')
    return ready?.fileName ? `${CV_PUBLIC_URL}/${applicationId}/${ready.fileName}` : null
}

/** What the mock "writes" for an application: the CV link in the e-mail and the messages. */
function contentOf(applicationId: string): MaterialsContent {
    const application = applications.find(item => item.id === applicationId)
    const company = application?.company || 'Example GmbH'
    const role = application?.role || 'Senior backend engineer'
    const cvUrl = cvUrlOf(applicationId) ?? `${CV_PUBLIC_URL}/${applicationId}/CV.pdf`
    const vacancy = application?.vacancyId ? vacancies.get(application.vacancyId) : undefined
    return {
        language: 'en',
        coverLetter: `Dear ${company} team,\n\nI would like to apply for the ${role} role. I have built and run TypeScript APIs on PostgreSQL for years.\n\nKind regards,\nAlex Example`,
        emailSubject: `${role}: Alex Example`,
        emailBody: `Hello,\n\nI am applying for the ${role} role at ${company}. My CV: ${cvUrl}\n\nBest,\nAlex Example`,
        telegramMessage: `Hi! I'd like to apply for the ${role} role at ${company}. CV: ${cvUrl}`,
        linkedinNote: `Hi, I applied for the ${role} role at ${company} and would be glad to connect.`,
        whyMe: [
            'Five years of backend work in TypeScript',
            'Runs PostgreSQL in production',
            'Written English every day',
        ],
        answers: (vacancy?.applyForm?.fields ?? [])
            .filter(field => field.type !== 'file')
            .map(field => ({
                key: field.key,
                label: field.label,
                answer: MOCK_ANSWERS[field.key] ?? '',
            })),
    }
}

/** Queues a materials version; as the job would, it is `generating`, then `ready` with its texts. */
function queueMaterials(applicationId: string): MaterialsVersion {
    const versions = materials.get(applicationId) ?? []
    const version: MaterialsVersion = {
        version: versions.length + 1,
        status: 'queued',
        error: null,
        content: null,
        updatedAt: new Date().toISOString(),
    }
    materials.set(applicationId, [
        ...versions,
        version,
    ])
    setTimeout(() => {
        if (version.status !== 'queued') return
        version.status = 'generating'
        version.updatedAt = new Date().toISOString()
        setTimeout(() => {
            if (version.status !== 'generating') return
            version.status = 'ready'
            version.content = contentOf(applicationId)
            version.updatedAt = new Date().toISOString()
        }, cvStepMs)
    }, cvStepMs)
    return version
}

/** The newest version's status and error; the texts of the newest ready one. */
function materialsOf(applicationId: string) {
    const versions = materials.get(applicationId) ?? []
    const latest = versions.at(-1)
    if (!latest)
        return {
            status: 'none' as const,
        }
    const ready = versions.findLast(version => version.status === 'ready')
    return {
        status: latest.status,
        version: latest.version,
        ...(ready?.content
            ? {
                  content: ready.content,
              }
            : {}),
        ...(latest.error
            ? {
                  error: latest.error,
              }
            : {}),
        updatedAt: latest.updatedAt,
    }
}

/** After a parse: version 1 for every application of the vacancy without a CV. */
function queueFirstCvs(vacancy: Vacancy) {
    if (vacancy.parseStatus !== 'parsed') return
    for (const application of applications) {
        if (application.vacancyId === vacancy.id && !cvs.has(application.id)) queueCv(application.id)
    }
}

/** The newest version's status, model and error; the link and pages of the newest ready one. */
function cvOf(applicationId: string) {
    const versions = cvs.get(applicationId) ?? []
    const latest = versions.at(-1)
    if (!latest)
        return {
            status: 'none' as const,
        }
    const ready = versions.findLast(version => version.status === 'ready')
    return {
        status: latest.status,
        version: latest.version,
        ...(ready?.fileName
            ? {
                  url: `${CV_PUBLIC_URL}/${applicationId}/${ready.fileName}`,
              }
            : {}),
        ...(ready?.pages
            ? {
                  pages: ready.pages,
              }
            : {}),
        ...(latest.model
            ? {
                  model: latest.model,
              }
            : {}),
        ...(latest.error
            ? {
                  error: latest.error,
              }
            : {}),
        updatedAt: latest.updatedAt,
    }
}

/** The application as the API answers it: its parse status is its vacancy's, its CV status the newest version's. */
function row(application: Application) {
    const vacancy = application.vacancyId ? vacancies.get(application.vacancyId) : undefined
    return {
        ...application,
        parseStatus: vacancy ? vacancy.parseStatus : application.parseStatus,
        cvStatus: cvOf(application.id).status,
        materialsStatus: materialsOf(application.id).status,
    }
}

function seed() {
    received = []
    profiles = new Map()
    vacancies = new Map()
    cvs = new Map()
    materials = new Map()
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
    const seeded: [
        number,
        'parsed' | 'failed' | 'pending',
        string | null,
    ][] = [
        [
            40,
            'parsed',
            null,
        ],
        [
            10,
            'parsed',
            null,
        ],
        [
            12,
            'parsed',
            null,
        ],
        [
            9,
            'failed',
            'no_text',
        ],
        [
            8,
            'pending',
            null,
        ],
        [
            7,
            'failed',
            'model_error',
        ],
    ]
    for (const [n, parseStatus, parseError] of seeded) {
        const application = applications.find(item => item.id === `application-${String(n).padStart(3, '0')}`)
        if (!application) continue
        const vacancy = newVacancy(application.vacancyUrl, parseError === 'no_text' ? '' : application.vacancyText)
        application.vacancyId = vacancy.id
        application.vacancyText = ''
        if (parseStatus !== 'pending') settle(vacancy, parseStatus, parseError)
        if (parseStatus === 'parsed')
            vacancy.parsed = parsedOf(application.company, application.role || 'Senior backend engineer')
        if (n === 40) vacancy.applyForm = MOCK_FORM
        if (n === 12) {
            vacancy.fetchStatus = 'failed'
            vacancy.fetchError = 'http_404'
        }
    }
    // Ready to send: its CV and its materials are made, nothing is sent yet.
    const ready = applications.find(item => item.id === 'application-040')
    if (ready) {
        const updatedAt = new Date(start).toISOString()
        cvs.set(ready.id, [
            {
                version: 1,
                status: 'ready',
                model: MOCK_MODEL,
                error: null,
                pages: 2,
                fileName: MOCK_CV_FILE_NAME,
                updatedAt,
            },
        ])
        materials.set(ready.id, [
            {
                version: 1,
                status: 'ready',
                error: null,
                content: contentOf(ready.id),
                updatedAt,
            },
        ])
    }
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
    const settleHook = path.match(/^\/__mock\/vacancies\/([^/]+)$/)
    if (method === 'POST' && settleHook) {
        const vacancy = vacancies.get(decodeURIComponent(settleHook[1] ?? ''))
        const body = (await readJson(req)) as
            | {
                  parseStatus?: unknown
                  parseError?: unknown
              }
            | undefined
        if (!vacancy || (body?.parseStatus !== 'parsed' && body?.parseStatus !== 'failed'))
            return fail(res, 404, 'NOT_FOUND', 'No such vacancy or status', requestId)
        settle(vacancy, body.parseStatus, typeof body.parseError === 'string' ? body.parseError : null)
        queueFirstCvs(vacancy)
        return send(res, 204, undefined, requestId)
    }

    const materialsHook = path.match(/^\/__mock\/applications\/([^/]+)\/materials$/)
    if (method === 'POST' && materialsHook) {
        const latest = materials.get(decodeURIComponent(materialsHook[1] ?? ''))?.at(-1)
        const body = (await readJson(req)) as
            | {
                  status?: unknown
                  error?: unknown
              }
            | undefined
        if (!latest || body?.status !== 'failed')
            return fail(res, 404, 'NOT_FOUND', 'No such materials or status', requestId)
        latest.status = 'failed'
        latest.error = typeof body.error === 'string' ? body.error : 'llm_bad_request'
        latest.updatedAt = new Date().toISOString()
        return send(res, 204, undefined, requestId)
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
        const items = applications.slice(start, start + limit).map(row)
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
        return send(
            res,
            200,
            {
                ...row(application),
                vacancy: (application.vacancyId && vacancies.get(application.vacancyId)) || null,
                cv: cvOf(application.id),
                materials: materialsOf(application.id),
            },
            requestId,
        )
    }

    if (method === 'PATCH' && detail) {
        const id = decodeURIComponent(detail[1] ?? '')
        let input: unknown
        try {
            input = await readJson(req, record)
        } catch {
            return fail(res, 400, 'VALIDATION_FAILED', 'Body is not JSON', requestId, [])
        }
        const body = (input ?? {}) as Record<string, unknown>
        const unknown = Object.keys(body).filter(key => key !== 'status')
        const status = statuses.find(value => value === body.status)
        if (!status || unknown.length > 0)
            return fail(res, 400, 'VALIDATION_FAILED', 'Request validation failed', requestId, [
                ...(status
                    ? []
                    : [
                          {
                              path: 'status',
                              message: `Invalid option: expected one of ${statuses.map(value => `"${value}"`).join('|')}`,
                          },
                      ]),
                ...unknown.map(key => ({
                    path: '',
                    message: `Unrecognized key: "${key}"`,
                })),
            ])
        const application = applications.find(item => item.id === id)
        if (!application) return fail(res, 404, 'NOT_FOUND', 'Application not found', requestId)
        if (application.company.startsWith('!fail')) return fail(res, 500, 'INTERNAL', 'Mock failure', requestId)
        application.status = status
        return send(res, 200, row(application), requestId)
    }

    const generateMaterials = path.match(/^\/api\/v1\/applications\/([^/]+)\/materials$/)
    if (method === 'POST' && generateMaterials) {
        const id = decodeURIComponent(generateMaterials[1] ?? '')
        const application = applications.find(item => item.id === id)
        if (!application) return fail(res, 404, 'NOT_FOUND', 'Application not found', requestId)
        if (!cvUrlOf(id))
            return fail(res, 409, 'CONFLICT', 'No CV of this application is ready: its materials follow it', requestId)
        const latest = materials.get(id)?.at(-1)
        if (latest?.status === 'queued' || latest?.status === 'generating')
            return fail(res, 409, 'CONFLICT', 'The materials of this application are already being written', requestId)
        const version = queueMaterials(id)
        return send(
            res,
            202,
            {
                status: 'queued',
                version: version.version,
                updatedAt: version.updatedAt,
            },
            requestId,
        )
    }

    const generateCv = path.match(/^\/api\/v1\/applications\/([^/]+)\/cv$/)
    if (method === 'POST' && generateCv) {
        const id = decodeURIComponent(generateCv[1] ?? '')
        const application = applications.find(item => item.id === id)
        if (!application) return fail(res, 404, 'NOT_FOUND', 'Application not found', requestId)
        if (row(application).parseStatus !== 'parsed')
            return fail(res, 409, 'CONFLICT', 'The vacancy is not parsed yet: its CV is made once it is', requestId)
        const latest = cvs.get(id)?.at(-1)
        if (latest?.status === 'queued' || latest?.status === 'generating')
            return fail(res, 409, 'CONFLICT', 'A CV of this application is already being made', requestId)
        const cv = queueCv(id)
        return send(
            res,
            202,
            {
                status: 'queued',
                version: cv.version,
                updatedAt: cv.updatedAt,
            },
            requestId,
        )
    }

    const reparse = path.match(/^\/api\/v1\/vacancies\/([^/]+)\/parse$/)
    if (method === 'POST' && reparse) {
        const id = decodeURIComponent(reparse[1] ?? '')
        const vacancy = applications.some(item => item.vacancyId === id) ? vacancies.get(id) : undefined
        if (!vacancy) return fail(res, 404, 'NOT_FOUND', `Vacancy ${id} not found`, requestId)
        vacancy.parseStatus = 'pending'
        vacancy.parseError = null
        vacancy.updatedAt = new Date().toISOString()
        setTimeout(() => {
            if (vacancy.parseStatus !== 'pending') return
            if (vacancy.rawText === '') settle(vacancy, 'failed', 'no_text')
            else settle(vacancy, 'parsed')
            queueFirstCvs(vacancy)
        }, parseDelayMs)
        return send(
            res,
            202,
            {
                vacancyId: vacancy.id,
                parseStatus: 'pending',
            },
            requestId,
        )
    }

    const refetch = path.match(/^\/api\/v1\/vacancies\/([^/]+)\/fetch$/)
    if (method === 'POST' && refetch) {
        const id = decodeURIComponent(refetch[1] ?? '')
        const vacancy = applications.some(item => item.vacancyId === id) ? vacancies.get(id) : undefined
        if (!vacancy) return fail(res, 404, 'NOT_FOUND', `Vacancy ${id} not found`, requestId)
        if (!vacancy.url) return fail(res, 409, 'CONFLICT', 'The vacancy has no link to fetch', requestId)
        vacancy.fetchStatus = 'pending'
        vacancy.fetchError = null
        vacancy.updatedAt = new Date().toISOString()
        setTimeout(() => {
            if (vacancy.fetchStatus !== 'pending') return
            vacancy.fetchStatus = 'fetched'
            vacancy.applyForm = MOCK_FORM
            vacancy.updatedAt = new Date().toISOString()
        }, parseDelayMs)
        return send(
            res,
            202,
            {
                vacancyId: vacancy.id,
                fetchStatus: 'pending',
            },
            requestId,
        )
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
        return send(res, 201, row(application), requestId)
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
            const vacancy = newVacancy(url ?? null, text)
            const application: Application = {
                id: randomUUID(),
                company: '',
                role: '',
                vacancyUrl: url ?? null,
                vacancyText: '',
                status: 'new',
                vacancyId: vacancy.id,
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
