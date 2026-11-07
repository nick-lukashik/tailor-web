import { type APIRequestContext, test as base, expect } from '@playwright/test'
import en from '../src/i18n/messages/en.json' with { type: 'json' }
import ru from '../src/i18n/messages/ru.json' with { type: 'json' }
import { type Application, type ApplicationPage } from '../src/lib/api/types'
import { API_DOWN_PORT, MOCK_API_PORT, NOINDEX_PORT } from './servers'

/** UI strings come from the catalogs, so a copy change does not break tests. */
export { en, ru }

const external = Boolean(process.env.PW_BASE_URL)

/** The mock API (started by playwright.config.ts, or yours with PW_BASE_URL). */
export const API_URL = process.env.PW_API_URL ?? `http://127.0.0.1:${MOCK_API_PORT}`
/** A real tailor-api, for the real-api project. */
export const REAL_API_URL = process.env.E2E_API_URL

/**
 * The same build started with ROBOTS=noindex (playwright.config.ts). Against
 * PW_BASE_URL it is set only by PW_NOINDEX_URL; without it those tests skip.
 */
export const NOINDEX_URL = process.env.PW_NOINDEX_URL ?? (external ? undefined : `http://127.0.0.1:${NOINDEX_PORT}`)
/** The same build with an API that does not answer; only with the bundled servers. */
export const API_DOWN_URL = external ? undefined : `http://127.0.0.1:${API_DOWN_PORT}`

export type BackendKind = 'mock' | 'real'
/** Project option (playwright.config.ts): which API the site under test talks to. */
export type BackendOptions = {
    backendKind: BackendKind
}

/** The API behind the site, called directly (not through the site) to set up and check data. */
export type Backend = {
    kind: BackendKind
    url: string
    /** Every application, newest first. */
    allApplications(): Promise<Application[]>
    create(input: { company: string; role?: string; vacancyUrl?: string; vacancyText?: string }): Promise<Application>
    /** Creates applications until there are at least `count` (the mock starts with 45). */
    ensureApplications(count: number): Promise<void>
}

function backendClient(kind: BackendKind, url: string, request: APIRequestContext): Backend {
    const client: Backend = {
        kind,
        url,
        async allApplications() {
            const applications: Application[] = []
            let cursor: string | null = null
            do {
                const response = await request.get(`${url}/api/v1/applications`, {
                    params: {
                        limit: 100,
                        ...(cursor
                            ? {
                                  cursor,
                              }
                            : {}),
                    },
                })
                expect(response.status(), 'GET /api/v1/applications').toBe(200)
                const page = (await response.json()) as ApplicationPage
                applications.push(...page.items)
                cursor = page.nextCursor
            } while (cursor)
            return applications
        },
        async create(input) {
            const response = await request.post(`${url}/api/v1/applications`, {
                data: input,
            })
            expect(
                response.status(),
                response.status() === 429
                    ? 'rate limited: start the API with a higher RATE_LIMIT_PER_MINUTE'
                    : 'create',
            ).toBe(201)
            return (await response.json()) as Application
        },
        async ensureApplications(count) {
            const have = (await client.allApplications()).length
            for (let n = have + 1; n <= count; n += 1) {
                await client.create({
                    company: `Seed company ${n}`,
                    vacancyText: `Vacancy text of seed application ${n}. Written by Playwright.`,
                })
            }
        },
    }
    return client
}

type Fixtures = {
    /** CSP violations reported by the page; the test fails if any are left. */
    cspViolations: string[]
    backend: Backend
}

/**
 * Every test fails on any Content Security Policy violation the page
 * reports. Against the mock it starts from the seed (45 applications); against a
 * real API (project real-api) the data is whatever is there, so the applications
 * specs only rely on what they create or read first.
 */
export const test = base.extend<Fixtures & BackendOptions>({
    backendKind: [
        'mock',
        {
            option: true,
        },
    ],
    backend: [
        async ({ backendKind, request }, use, testInfo) => {
            if (backendKind === 'real' && !REAL_API_URL) {
                testInfo.skip(
                    true,
                    'set E2E_API_URL to run against a real API (README, "End-to-end against a real API")',
                )
            }
            await use(backendClient(backendKind, backendKind === 'real' ? (REAL_API_URL ?? '') : API_URL, request))
        },
        {
            auto: true,
        },
    ],
    cspViolations: [
        async ({ page }, use) => {
            const violations: string[] = []
            page.on('console', message => {
                if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
                    violations.push(message.text())
                }
            })
            await use(violations)
            expect(violations, 'CSP violations').toEqual([])
        },
        {
            auto: true,
        },
    ],
    page: async ({ page, backend }, use) => {
        if (backend.kind === 'mock') await mockApi.reset()
        await use(page)
    },
})

export { expect }

/** One /api request as the mock API received it (e2e/mock-api/server.ts). */
export type ReceivedRequest = {
    method: string
    path: string
    headers: Record<string, string | string[] | undefined>
    bodyBytes?: number
    aborted: boolean
}

/** Test hooks of the mock API. */
export const mockApi = {
    /** Back to the seed, request log cleared. */
    async reset() {
        const response = await fetch(`${API_URL}/__mock/reset`, {
            method: 'POST',
        })
        expect(response.status, 'mock reset').toBe(204)
    },
    /** The /api requests that reached the mock since the last reset. */
    async requests(): Promise<ReceivedRequest[]> {
        return (await fetch(`${API_URL}/__mock/requests`)).json() as Promise<ReceivedRequest[]>
    },
}

/** A name no other test uses. */
export const uniqueTitle = (prefix: string) =>
    `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
