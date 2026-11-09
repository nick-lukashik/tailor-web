import { type InfiniteData, MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { applicationKeys, applicationMutations, detailInProgress, rowInProgress } from './applications'
import { createApiClient } from './client'
import { type Application, type ApplicationDetail, type ApplicationPage } from './types'

const row = (id: string, changes: Partial<Application> = {}): Application => ({
    id,
    company: `Company ${id}`,
    role: '',
    vacancyUrl: null,
    vacancyText: '',
    status: 'new',
    vacancyId: null,
    parseStatus: 'parsed',
    cvStatus: 'ready',
    materialsStatus: 'ready',
    createdAt: '2026-11-09T10:00:00.000Z',
    ...changes,
})

const detail = (changes: Partial<ApplicationDetail> = {}): ApplicationDetail => ({
    ...row('a'),
    vacancy: null,
    cv: {
        status: 'ready',
        url: 'https://cv.example.com/a/CV.pdf',
    },
    materials: {
        status: 'ready',
    },
    ...changes,
})

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    })

/** A query client with application `a` cached on its page and in a list of two, and an API answering `answer`. */
function setup(answer: Promise<Response>) {
    const fetch = vi.fn<typeof globalThis.fetch>(() => answer)
    const api = createApiClient({
        baseUrl: '',
        fetch,
    })
    const client = new QueryClient()
    client.setQueryData(applicationKeys.detail('a'), detail())
    client.setQueryData<InfiniteData<ApplicationPage, string | null>>(applicationKeys.list(20), {
        pages: [
            {
                items: [
                    row('a'),
                    row('b'),
                ],
                nextCursor: null,
            },
        ],
        pageParams: [
            null,
        ],
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const observer = new MutationObserver(client, applicationMutations.updateStatus(api))
    const statuses = () => ({
        detail: client.getQueryData<ApplicationDetail>(applicationKeys.detail('a'))?.status,
        list: client
            .getQueryData<InfiniteData<ApplicationPage>>(applicationKeys.list(20))
            ?.pages[0]?.items.map(item => item.status),
    })
    return {
        fetch,
        observer,
        statuses,
        invalidate,
    }
}

/** A promise settled by hand, to look at the cache while the request is in flight. */
function deferred<T>() {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>(done => {
        resolve = done
    })
    return {
        promise,
        resolve,
    }
}

describe('updateStatus', () => {
    it('shows the new status at once on the page and in the list, then refetches', async () => {
        const answer = deferred<Response>()
        const { fetch, observer, statuses, invalidate } = setup(answer.promise)
        const done = observer.mutate({
            id: 'a',
            status: 'sent',
        })
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
        expect(statuses()).toEqual({
            detail: 'sent',
            list: [
                'sent',
                'new',
            ],
        })
        const [url, init] = fetch.mock.calls[0] ?? []
        expect(url).toBe('/api/v1/applications/a')
        expect(init?.method).toBe('PATCH')
        expect(JSON.parse(String(init?.body))).toEqual({
            status: 'sent',
        })

        answer.resolve(
            json(
                200,
                row('a', {
                    status: 'sent',
                }),
            ),
        )
        await expect(done).resolves.toMatchObject({
            status: 'sent',
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: applicationKeys.all,
        })
    })

    it('puts the old status back when the API refuses', async () => {
        const { observer, statuses, invalidate } = setup(
            Promise.resolve(
                json(404, {
                    code: 'NOT_FOUND',
                    message: 'Application not found',
                    requestId: 'r1',
                }),
            ),
        )
        await expect(
            observer.mutate({
                id: 'a',
                status: 'rejected',
            }),
        ).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
        expect(statuses()).toEqual({
            detail: 'new',
            list: [
                'new',
                'new',
            ],
        })
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: applicationKeys.all,
        })
    })
})

describe('generateMaterials', () => {
    it('posts to the materials of the application and refetches, after a 409 too', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () =>
            json(409, {
                code: 'CONFLICT',
                message: 'The materials of this application are already being written',
                requestId: 'r2',
            }),
        )
        const client = new QueryClient()
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        const observer = new MutationObserver(
            client,
            applicationMutations.generateMaterials(
                createApiClient({
                    baseUrl: '',
                    fetch,
                }),
            ),
        )
        await expect(observer.mutate('a b')).rejects.toMatchObject({
            code: 'CONFLICT',
            message: 'The materials of this application are already being written',
        })
        expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/applications/a%20b/materials')
        expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: applicationKeys.all,
        })
    })
})

describe('detailInProgress', () => {
    it.each([
        [
            'queued',
            true,
        ],
        [
            'generating',
            true,
        ],
        [
            'ready',
            false,
        ],
        [
            'failed',
            false,
        ],
        [
            'none',
            false,
        ],
    ] as const)('polls while the materials are %s: %s', (status, polls) => {
        expect(
            detailInProgress(
                detail({
                    materials: {
                        status,
                    },
                }),
            ),
        ).toBe(polls)
    })
})

describe('detailInProgress and the vacancy', () => {
    const vacancy: NonNullable<ApplicationDetail['vacancy']> = {
        id: 'v',
        url: 'https://example.com/jobs/1',
        rawText: '',
        parseStatus: 'parsed',
        parseError: null,
        updatedAt: '2026-11-09T10:00:00.000Z',
        model: null,
        parsed: null,
        applyForm: null,
        fetchStatus: 'fetched',
        fetchError: null,
    }
    it.each([
        [
            {
                fetchStatus: 'pending',
            },
            true,
        ],
        [
            {
                parseStatus: 'pending',
            },
            true,
        ],
        [
            {
                fetchStatus: 'failed',
            },
            false,
        ],
        [
            {},
            false,
        ],
    ] as [
        Partial<NonNullable<ApplicationDetail['vacancy']>>,
        boolean,
    ][])('%j → %s', (changes, polls) => {
        expect(
            detailInProgress(
                detail({
                    vacancy: {
                        ...vacancy,
                        ...changes,
                    },
                }),
            ),
        ).toBe(polls)
    })
})

describe('rowInProgress', () => {
    it.each([
        [
            {
                parseStatus: 'pending',
            },
            true,
        ],
        [
            {
                cvStatus: 'queued',
            },
            true,
        ],
        [
            {
                materialsStatus: 'generating',
            },
            true,
        ],
        [
            {},
            false,
        ],
        [
            {
                parseStatus: 'failed',
                cvStatus: 'none',
                materialsStatus: 'none',
            },
            false,
        ],
    ] as [
        Partial<Application>,
        boolean,
    ][])('%j → %s', (changes, polls) => {
        expect(rowInProgress(row('a', changes))).toBe(polls)
    })
})
