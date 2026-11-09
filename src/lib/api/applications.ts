import { type InfiniteData, infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query'
import { type ApiClient } from './client'
import {
    type Application,
    type ApplicationDetail,
    type ApplicationPage,
    type ApplicationStatus,
    type CreateApplicationInput,
    type CvQueued,
    type ListApplicationsQuery,
    type MaterialsQueued,
} from './types'

export const APPLICATIONS_PAGE_SIZE = 20
/** How often an application page (and the list) asks again while a vacancy is read or a CV or messages are written. */
export const DETAIL_POLL_MS = 5_000

const running = (status: string) => status === 'queued' || status === 'generating'

/** Still in the works on the API (the vacancy read, the CV or the messages written): the page keeps asking. */
export function detailInProgress(application: Pick<ApplicationDetail, 'vacancy' | 'cv' | 'materials'>): boolean {
    return (
        application.vacancy?.parseStatus === 'pending'
        || running(application.cv.status)
        || running(application.materials.status)
    )
}

/** A list row whose vacancy is read or whose CV or messages are written: the list keeps asking. */
export function rowInProgress(row: Pick<Application, 'parseStatus' | 'cvStatus' | 'materialsStatus'>): boolean {
    return row.parseStatus === 'pending' || running(row.cvStatus) || running(row.materialsStatus)
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
    /** Queues new messages from the newest ready CV (202); 409 without one or while a version is written. */
    generateMaterials: (api: ApiClient, id: string) =>
        api.request<MaterialsQueued>(`/api/v1/applications/${encodeURIComponent(id)}/materials`, {
            method: 'POST',
        }),
    /** Sets the status by hand (`sent` once applied); answers the list row. */
    updateStatus: (api: ApiClient, id: string, status: ApplicationStatus) =>
        api.request<Application>(`/api/v1/applications/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: {
                status,
            },
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
    generateMaterials: () =>
        [
            ...applicationKeys.all,
            'generate-materials',
        ] as const,
    updateStatus: () =>
        [
            ...applicationKeys.all,
            'update-status',
        ] as const,
}

export type StatusChange = {
    id: string
    status: ApplicationStatus
}

type ListData = InfiniteData<ApplicationPage, string | null>

/** The cached lists and the page as they were before an optimistic change, to put back after a failure. */
type StatusSnapshot = {
    detail: ApplicationDetail | undefined
    lists: [
        readonly unknown[],
        ListData | undefined,
    ][]
}

/** Every cached list with one row's status changed. */
function withStatus(data: ListData | undefined, { id, status }: StatusChange): ListData | undefined {
    if (!data) return data
    return {
        ...data,
        pages: data.pages.map(page => ({
            ...page,
            items: page.items.map(item =>
                item.id === id
                    ? {
                          ...item,
                          status,
                      }
                    : item,
            ),
        })),
    }
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
            // Rows move from reading to ready to send in the background: ask again while one is on its way.
            refetchInterval: query =>
                query.state.data?.pages.some(page => page.items.some(rowInProgress)) ? DETAIL_POLL_MS : false,
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
    /** New messages: as for the CV, everything refetches (after a 409 too) and the page polls. */
    generateMaterials: (api: ApiClient) =>
        mutationOptions({
            mutationKey: applicationKeys.generateMaterials(),
            mutationFn: (id: string) => applicationsApi.generateMaterials(api, id),
            onSettled: (_result, _error, _id, _onMutateResult, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.all,
                }),
        }),
    /**
     * The status set by hand, shown at once on the page and in every list;
     * put back if the API refuses, then everything refetches.
     */
    updateStatus: (api: ApiClient) =>
        mutationOptions({
            mutationKey: applicationKeys.updateStatus(),
            mutationFn: ({ id, status }: StatusChange) => applicationsApi.updateStatus(api, id, status),
            onMutate: async (change, context): Promise<StatusSnapshot> => {
                const { client } = context
                await client.cancelQueries({
                    queryKey: applicationKeys.all,
                })
                const detailKey = applicationKeys.detail(change.id)
                const snapshot: StatusSnapshot = {
                    detail: client.getQueryData<ApplicationDetail>(detailKey),
                    lists: client.getQueriesData<ListData>({
                        queryKey: applicationKeys.lists(),
                    }),
                }
                if (snapshot.detail)
                    client.setQueryData<ApplicationDetail>(detailKey, {
                        ...snapshot.detail,
                        status: change.status,
                    })
                client.setQueriesData<ListData>(
                    {
                        queryKey: applicationKeys.lists(),
                    },
                    data => withStatus(data, change),
                )
                return snapshot
            },
            onError: (_error, change, snapshot, context) => {
                if (!snapshot) return
                context.client.setQueryData(applicationKeys.detail(change.id), snapshot.detail)
                for (const [key, data] of snapshot.lists) context.client.setQueryData(key, data)
            },
            onSettled: (_result, _error, _change, _snapshot, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.all,
                }),
        }),
}
