import { serverEnv } from '@/lib/env/server'
import { logger } from '@/lib/logger'

// Readiness (service contract, kind web): this server can render, so 200.
// The API's state is reported, not required: pages that need no API keep
// working, and pages that do show their own error state while it is down.
// Taking every web pod out of the load balancer would turn an API outage
// into a full site outage.
export const dynamic = 'force-dynamic'

/** Below the readiness probe's 3 s timeout (gitops components/service). */
const API_TIMEOUT_MS = 2000

async function apiState(): Promise<'ok' | 'down'> {
    try {
        const answer = await fetch(`${serverEnv.API_URL}/health/ready`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
        })
        if (answer.ok) return 'ok'
        logger.warn(
            {
                status: answer.status,
            },
            'api not ready',
        )
    } catch (error) {
        logger.warn(
            {
                err: error,
            },
            'api unreachable',
        )
    }
    return 'down'
}

export async function GET() {
    const api = await apiState()
    return Response.json(
        {
            status: api === 'ok' ? 'ok' : 'degraded',
            version: serverEnv.APP_VERSION,
            checks: {
                api,
            },
        },
        {
            headers: {
                'cache-control': 'no-store',
            },
        },
    )
}
