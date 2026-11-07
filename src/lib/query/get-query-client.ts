import { defaultShouldDehydrateQuery, environmentManager, QueryClient } from '@tanstack/react-query'
import { type ApiError, isApiError } from '@/lib/api/errors'

// Errors of every query and mutation are ApiError (src/lib/api/client.ts).
declare module '@tanstack/react-query' {
    // biome-ignore lint/style/useConsistentTypeDefinitions: augmentation must merge into TanStack's Register interface.
    interface Register {
        defaultError: ApiError
    }
}

const MAX_RETRIES = 2

export function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                // Above 0, so data prefetched on the server is not refetched on mount.
                staleTime: 30 * 1000,
                // 4xx answers will not change on retry; outages may.
                retry: (failureCount, error) => failureCount < MAX_RETRIES && (!isApiError(error) || error.retryable),
            },
            dehydrate: {
                // Also send queries still in flight, so a page may stream them later.
                shouldDehydrateQuery: query => defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
                // Next.js redacts server errors itself and needs to see its own.
                shouldRedactErrors: () => false,
            },
        },
    })
}

let browserQueryClient: QueryClient | undefined

/**
 * Server: a new client per call (per request; pages use the cached
 * getServerQueryClient). Browser: one client for the session, so a render
 * that suspends before mount does not lose the cache.
 */
export function getQueryClient() {
    if (environmentManager.isServer()) return makeQueryClient()
    browserQueryClient ??= makeQueryClient()
    return browserQueryClient
}
