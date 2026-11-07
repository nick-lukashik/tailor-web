import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

async function ready(api: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(api))
    const { GET } = await import('./route')
    return GET()
}

beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('API_URL', 'http://api.example.com')
    vi.stubEnv('APP_VERSION', 'test')
    vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('GET /health/ready', () => {
    it('is ready and reports the API as ok', async () => {
        const response = await ready(async () => Response.json({}))
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            status: 'ok',
            version: 'test',
            checks: {
                api: 'ok',
            },
        })
        expect(fetch).toHaveBeenCalledWith('http://api.example.com/health/ready', expect.anything())
    })

    it.for([
        [
            'unreachable',
            () => Promise.reject(new TypeError('fetch failed')),
        ],
        [
            'not ready',
            async () =>
                new Response(null, {
                    status: 503,
                }),
        ],
    ] as const)('stays ready when the API is %s, and says so', async ([, api]) => {
        const response = await ready(api)
        // Contract (web): the API's state is reported, not required.
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            status: 'degraded',
            checks: {
                api: 'down',
            },
        })
    })
})
