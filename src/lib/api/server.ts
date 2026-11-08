import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { serverEnv } from '@/lib/env/server'
import { visitorHeaders } from '@/lib/http/forwarded-headers'
import { logger } from '@/lib/logger'
import { REQUEST_ID_HEADER } from '@/lib/request-id'
import { requestSession } from '@/lib/session/request'
import { createApiClient } from './client'

/**
 * The server's client for Server Components and generateMetadata: API_URL
 * directly, the page's request id, the visitor headers of the allow-list and
 * the person's access token from the session (never the browser's cookies or
 * identity headers), every call logged. One per request (React cache).
 */
export const serverApi = cache(async () => {
    const [incoming, session] = await Promise.all([
        headers(),
        requestSession(),
    ])
    const requestId = incoming.get(REQUEST_ID_HEADER) ?? undefined
    const forwarded = {
        ...visitorHeaders(incoming),
        ...(requestId
            ? {
                  [REQUEST_ID_HEADER]: requestId,
              }
            : {}),
        ...(session
            ? {
                  authorization: `Bearer ${session.accessToken}`,
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
