import { infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query'
import { type ApiClient } from './client'
import {
    type Application,
    type ApplicationDetail,
    type ApplicationPage,
    type CreateApplicationInput,
    type CvQueued,
    type ListApplicationsQuery,
} from './types'

export const APPLICATIONS_PAGE_SIZE = 20
/** How often an application page asks again while its vacancy is read or its CV is made. */
export const DETAIL_POLL_MS = 5_000

/** Still in the works on the API: the page keeps asking. */
export function detailInProgress(application: Pick<ApplicationDetail, 'vacancy' | 'cv'>): boolean {
    return (
        application.vacancy?.parseStatus === 'pending'
        || application.cv.status === 'queued'
        || application.cv.status === 'generating'
    )
}

/** Endpoints of the applications resource (tailor-api). The client is passed in: server or browser. */
export const applicationsApi = {
    list: (api: ApiClient, query: ListApplicationsQuery = {}, signal?: AbortSignal) =>
        api.request<ApplicationPage>('/api/v1/applications', {
            query,
            signal,
        }),
    get: (api: ApiClient, id: string, signal?: AbortSignal) =>
        api.request<ApplicationDetail>(`/api/v1/applications/${encodeURIComponent(id)}`, {
            signal,
        }),
    /** Queues a new CV version (202); 409 while one is in the works or the vacancy is not parsed yet. */
    generateCv: (api: ApiClient, id: string) =>
        api.request<CvQueued>(`/api/v1/applications/${encodeURIComponent(id)}/cv`, {
            method: 'POST',
        }),
    /** Not used by the pages yet (applications are added by the pipeline, later). */
    create: (api: ApiClient, input: CreateApplicationInput) =>
        api.request<Application>('/api/v1/applications', {
            method: 'POST',
            body: input,
        }),
}

/**
 * Query keys, broad to narrow: invalidating `applicationKeys.all` refreshes
 * everything about applications, `applicationKeys.lists()` every list.
 */
export const applicationKeys = {
    all: [
        'applications',
    ] as const,
    lists: () =>
        [
            ...applicationKeys.all,
            'list',
        ] as const,
    list: (limit: number) =>
        [
            ...applicationKeys.lists(),
            {
                limit,
            },
        ] as const,
    details: () =>
        [
            ...applicationKeys.all,
            'detail',
        ] as const,
    detail: (id: string) =>
        [
            ...applicationKeys.details(),
            id,
        ] as const,
    generateCv: () =>
        [
            ...applicationKeys.all,
            'generate-cv',
        ] as const,
}

/**
 * Options shared by server prefetch and client hooks: the same key, a
 * queryFn bound to whichever client runs it.
 */
export const applicationQueries = {
    list: (api: ApiClient, limit = APPLICATIONS_PAGE_SIZE) =>
        infiniteQueryOptions({
            queryKey: applicationKeys.list(limit),
            queryFn: ({ pageParam, signal }) =>
                applicationsApi.list(
                    api,
                    {
                        limit,
                        cursor: pageParam ?? undefined,
                    },
                    signal,
                ),
            initialPageParam: null as string | null,
            getNextPageParam: lastPage => lastPage.nextCursor,
        }),
    detail: (api: ApiClient, id: string) =>
        queryOptions({
            queryKey: applicationKeys.detail(id),
            queryFn: ({ signal }) => applicationsApi.get(api, id, signal),
            // The vacancy is read and the CV made in the background: ask again until they are done.
            refetchInterval: query => (query.state.data && detailInProgress(query.state.data) ? DETAIL_POLL_MS : false),
        }),
}

export const applicationMutations = {
    /**
     * A new CV version: the page and the lists refetch, after a 409 too (a
     * version may already be in the works), and the page polls while it is.
     */
    generateCv: (api: ApiClient) =>
        mutationOptions({
            mutationKey: applicationKeys.generateCv(),
            mutationFn: (id: string) => applicationsApi.generateCv(api, id),
            onSettled: (_result, _error, _id, _onMutateResult, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.all,
                }),
        }),
}
