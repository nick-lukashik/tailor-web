import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { type ApiClient } from './client'
import {
    type Application,
    type ApplicationPage,
    type CreateApplicationInput,
    type ListApplicationsQuery,
} from './types'

export const APPLICATIONS_PAGE_SIZE = 20

/** Endpoints of the applications resource (tailor-api). The client is passed in: server or browser. */
export const applicationsApi = {
    list: (api: ApiClient, query: ListApplicationsQuery = {}, signal?: AbortSignal) =>
        api.request<ApplicationPage>('/api/v1/applications', {
            query,
            signal,
        }),
    get: (api: ApiClient, id: string, signal?: AbortSignal) =>
        api.request<Application>(`/api/v1/applications/${encodeURIComponent(id)}`, {
            signal,
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
        }),
}
