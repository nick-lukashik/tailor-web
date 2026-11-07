import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { serverEnv } from '@/lib/env/server'
import { visitorHeaders } from '@/lib/http/forwarded-headers'
import { logger } from '@/lib/logger'
import { REQUEST_ID_HEADER } from '@/lib/request-id'
import { createApiClient } from './client'

/**
 * The server's client for Server Components, generateMetadata and route
 * handlers: API_URL directly, the page's request id and the visitor headers
 * of the allow-list forwarded (never cookies or identity headers), every
 * call logged. One per request (React cache).
 */
export const serverApi = cache(async () => {
    const incoming = await headers()
    const requestId = incoming.get(REQUEST_ID_HEADER) ?? undefined
    const forwarded = {
        ...visitorHeaders(incoming),
        ...(requestId
            ? {
                  [REQUEST_ID_HEADER]: requestId,
              }
            : {}),
    }
    const log = logger.child({
        requestId,
    })
    return createApiClient({
        baseUrl: serverEnv.API_URL,
        timeoutMs: serverEnv.API_REQUEST_TIMEOUT_MS,
        headers: () => forwarded,
        onResponse: call =>
            log[call.status >= 500 ? 'error' : 'info'](
                {
                    api: call,
                },
                'api call',
            ),
    })
})
