import { describe, expect, it, vi } from 'vitest'
import { applicationsApi } from './applications'
import { createApiClient } from './client'
import { type ApiError, fieldOf, isApiError, pathOf, toApiError } from './errors'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
    })

function clientWith(answer: Response | Error) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        if (answer instanceof Error) throw answer
        return answer
    })
    const onResponse = vi.fn()
    const api = createApiClient({
        baseUrl: 'http://api.test',
        fetch,
        onResponse,
        headers: () => ({
            'x-request-id': 'req-12345678',
        }),
    })
    return {
        api,
        fetch,
        onResponse,
    }
}

const caught = (promise: Promise<unknown>) =>
    promise.then(
        () => {
            throw new Error('expected a rejection')
        },
        (error: unknown) => error,
    )

describe('createApiClient', () => {
    it('builds the URL, skips empty query values and returns the JSON body', async () => {
        const page = {
            items: [],
            nextCursor: null,
        }
        const { api, fetch, onResponse } = clientWith(json(200, page))

        await expect(
            applicationsApi.list(api, {
                limit: 20,
                cursor: undefined,
            }),
        ).resolves.toEqual(page)

        const [url, init] = fetch.mock.calls[0] ?? []
        expect(url).toBe('http://api.test/api/v1/applications?limit=20')
        expect(init?.method).toBe('GET')
        expect(new Headers(init?.headers).get('x-request-id')).toBe('req-12345678')
        expect(onResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'GET',
                path: '/api/v1/applications',
                status: 200,
            }),
        )
    })

    it('sends JSON bodies', async () => {
        const application = {
            id: '1',
            company: 'Hi',
            role: '',
            vacancyUrl: null,
            vacancyText: '',
            status: 'new',
            createdAt: '2026-11-02T10:00:00.000Z',
        }
        const { api, fetch } = clientWith(json(201, application))

        await expect(
            applicationsApi.create(api, {
                company: 'Hi',
                role: '',
                vacancyText: '',
            }),
        ).resolves.toEqual(application)

        const init = fetch.mock.calls[0]?.[1]
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(
            JSON.stringify({
                company: 'Hi',
                role: '',
                vacancyText: '',
            }),
        )
        expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    })

    it('maps a contract error with field details', async () => {
        const { api } = clientWith(
            json(400, {
                code: 'VALIDATION_FAILED',
                message: 'Validation failed',
                details: [
                    {
                        path: 'company',
                        message: 'Too short',
                    },
                    {
                        path: [
                            'vacancyText',
                        ],
                        message: 'Too long',
                    },
                ],
                requestId: 'req-from-api',
            }),
        )

        const error = await caught(
            applicationsApi.create(api, {
                company: '',
                role: '',
                vacancyText: '',
            }),
        )

        expect(isApiError(error)).toBe(true)
        const apiError = error as ApiError
        expect(apiError).toMatchObject({
            status: 400,
            code: 'VALIDATION_FAILED',
            requestId: 'req-from-api',
        })
        expect(apiError.fieldErrors()).toEqual({
            company: 'Too short',
            vacancyText: 'Too long',
        })
        expect(apiError.retryable).toBe(false)
    })

    it('maps NOT_FOUND', async () => {
        const { api } = clientWith(
            json(404, {
                code: 'NOT_FOUND',
                message: 'Application not found',
                requestId: 'r1',
            }),
        )
        await expect(applicationsApi.get(api, 'missing')).rejects.toMatchObject({
            status: 404,
            code: 'NOT_FOUND',
        })
    })

    it('maps a non-contract error page by status and keeps the request id header', async () => {
        const { api } = clientWith(
            new Response('<html>Bad gateway</html>', {
                status: 502,
                headers: {
                    'x-request-id': 'edge-123456',
                },
            }),
        )
        const error = (await caught(applicationsApi.list(api))) as ApiError
        expect(error).toMatchObject({
            status: 502,
            code: 'UNAVAILABLE',
            requestId: 'edge-123456',
        })
        expect(error.retryable).toBe(true)
    })

    it('turns a network failure into UNAVAILABLE', async () => {
        const { api, onResponse } = clientWith(new TypeError('fetch failed'))
        await expect(applicationsApi.list(api)).rejects.toMatchObject({
            status: 0,
            code: 'UNAVAILABLE',
        })
        expect(onResponse).not.toHaveBeenCalled()
    })

    it("keeps the caller's abort as an abort", async () => {
        const controller = new AbortController()
        controller.abort()
        const abort = new DOMException('Aborted', 'AbortError')
        const { api } = clientWith(abort)
        await expect(applicationsApi.list(api, {}, controller.signal)).rejects.toBe(abort)
    })

    it('rejects a 2xx answer that is not JSON', async () => {
        const { api } = clientWith(
            new Response('ok', {
                status: 200,
            }),
        )
        await expect(applicationsApi.list(api)).rejects.toMatchObject({
            code: 'INTERNAL',
        })
    })
})

describe('fieldOf', () => {
    it.each([
        [
            'title',
            'title',
        ],
        [
            '/title',
            'title',
        ],
        [
            'body.title',
            'title',
        ],
        [
            [
                'body',
            ],
            'body',
        ],
        [
            undefined,
            '',
        ],
    ])('%j → %s', (path, field) => {
        expect(fieldOf(path)).toBe(field)
    })
})

describe('pathOf', () => {
    it.each([
        [
            'cases.0.employmentId',
            'cases.0.employmentId',
        ],
        [
            [
                'person',
                'links',
                0,
                'url',
            ],
            'person.links.0.url',
        ],
        [
            '',
            '',
        ],
        [
            undefined,
            '',
        ],
    ])('%j → %s', (path, whole) => {
        expect(pathOf(path)).toBe(whole)
    })

    it('keeps the whole path of each detail, and the access codes of tailor-api', () => {
        const error = toApiError(400, {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: [
                {
                    path: 'cases.3.projectId',
                    message: 'no project',
                },
            ],
            requestId: 'r',
        })
        expect(error.details).toEqual([
            {
                path: 'cases.3.projectId',
                message: 'no project',
            },
        ])
        expect(error.fieldErrors()).toEqual({
            cases: 'no project',
        })
        expect(
            toApiError(403, {
                code: 'FORBIDDEN',
                message: 'Forbidden',
                requestId: 'r',
            }).code,
        ).toBe('FORBIDDEN')
        expect(toApiError(401, undefined).code).toBe('UNAUTHORIZED')
    })

    it('keeps the message of a CONFLICT, the 409 of tailor-api', () => {
        const error = toApiError(409, {
            code: 'CONFLICT',
            message: 'A CV of this application is already being made',
            requestId: 'r',
        })
        expect(error.code).toBe('CONFLICT')
        expect(error.message).toBe('A CV of this application is already being made')
        expect(toApiError(409, undefined).code).toBe('CONFLICT')
    })
})
