import { REQUEST_ID_HEADER } from '@/lib/request-id'
import { ApiError, toApiError } from './errors'

export type ApiCall = {
    method: string
    path: string
    status: number
    durationMs: number
    requestId?: string
}

export type ApiClientOptions = {
    /** "" in the browser (same-origin /api proxy), API_URL on the server. */
    baseUrl: string
    /** Extra headers per call, e.g. the request id on the server. */
    headers?: () => Record<string, string> | Promise<Record<string, string>>
    /** Default 12 s: above the /api proxy's 10 s budget, so its 504 arrives first. */
    timeoutMs?: number
    fetch?: typeof fetch
    /** Called after every answered call (logging, metrics). */
    onResponse?: (call: ApiCall) => void
}

export type RequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    query?: Record<string, string | number | boolean | null | undefined>
    body?: unknown
    signal?: AbortSignal
}

export type ApiClient = {
    request<T>(path: string, options?: RequestOptions): Promise<T>
}

function search(query: RequestOptions['query']): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null) params.set(key, String(value))
    }
    const text = params.toString()
    return text ? `?${text}` : ''
}

function parse(text: string): unknown {
    try {
        return text ? JSON.parse(text) : undefined
    } catch {
        return undefined
    }
}

/**
 * Typed fetch for the backend contract: JSON in and out, a timeout on every
 * call, non-2xx answers and network failures turned into ApiError.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
    const doFetch = options.fetch ?? fetch
    const timeoutMs = options.timeoutMs ?? 12_000

    return {
        async request<T>(path: string, { method = 'GET', query, body, signal }: RequestOptions = {}) {
            const url = `${options.baseUrl}${path}${search(query)}`
            const started = performance.now()
            const timeout = AbortSignal.timeout(timeoutMs)
            let response: Response
            try {
                response = await doFetch(url, {
                    method,
                    headers: {
                        accept: 'application/json',
                        ...(body !== undefined
                            ? {
                                  'content-type': 'application/json',
                              }
                            : {}),
                        ...(await options.headers?.()),
                    },
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                    signal: signal
                        ? AbortSignal.any([
                              signal,
                              timeout,
                          ])
                        : timeout,
                    cache: 'no-store',
                })
            } catch (error) {
                // Cancellation by the caller (e.g. TanStack Query) must stay an abort.
                if (signal?.aborted) throw error
                const reason = timeout.aborted ? `Timed out after ${timeoutMs} ms` : String(error)
                throw new ApiError(0, 'UNAVAILABLE', reason)
            }

            const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined
            options.onResponse?.({
                method,
                path,
                status: response.status,
                durationMs: Math.round(performance.now() - started),
                requestId,
            })

            const data = response.status === 204 ? undefined : parse(await response.text())
            if (!response.ok) throw toApiError(response.status, data, requestId)
            if (data === undefined && response.status !== 204) {
                throw new ApiError(response.status, 'INTERNAL', 'Invalid JSON in response', [], requestId)
            }
            return data as T
        },
    }
}
