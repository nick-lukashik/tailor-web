import http from 'node:http'
import { expect, mockApi, test, uniqueTitle } from './fixtures'
import { BODY_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS } from './servers'

// The /api proxy against the mock API: the 1 MiB body limit, the body and
// upstream deadlines (shortened on the e2e server, e2e/servers.ts), aborts,
// and the request header allow-list (docs/auth.md).

const MiB = 1024 * 1024
const JSON_HEADERS = {
    'content-type': 'application/json',
}
const deadlines = !process.env.PW_BASE_URL

type Answer = {
    status: number
    body: unknown
    ms: number
}

/**
 * POSTs `total` bytes with node:http, which can send a chunked body (no
 * Content-Length) and send it slowly; APIRequestContext can do neither.
 * Stops sending once the answer arrives.
 */
function post(
    url: string,
    {
        total,
        chunked = false,
        chunkSize = 64 * 1024,
        everyMs = 0,
    }: {
        total: number
        chunked?: boolean
        chunkSize?: number
        everyMs?: number
    },
): Promise<Answer> {
    const started = performance.now()
    return new Promise((resolve, reject) => {
        const request = http.request(url, {
            method: 'POST',
            headers: {
                ...JSON_HEADERS,
                ...(chunked
                    ? {}
                    : {
                          'content-length': String(total),
                      }),
            },
        })
        let answered = false
        let sent = 0
        request.on('response', response => {
            answered = true
            let text = ''
            response.setEncoding('utf8')
            response.on('data', chunk => {
                text += chunk
            })
            response.on('end', () =>
                resolve({
                    status: response.statusCode ?? 0,
                    body: text ? JSON.parse(text) : undefined,
                    ms: performance.now() - started,
                }),
            )
        })
        request.on('error', reject)
        const chunk = Buffer.alloc(chunkSize, 'a')
        const next = () => {
            if (answered || request.destroyed) return
            if (sent >= total) {
                request.end()
                return
            }
            const size = Math.min(chunkSize, total - sent)
            sent += size
            const flowing = request.write(chunk.subarray(0, size))
            if (everyMs) setTimeout(next, everyMs)
            else if (flowing) setImmediate(next)
            else request.once('drain', next)
        }
        next()
    })
}

test.describe('/api proxy', () => {
    test.beforeEach(async () => {
        await mockApi.reset()
    })

    test('a body over 1 MiB with Content-Length gets 413 and never reaches the API', async ({ request }) => {
        const response = await request.post('/api/v1/applications', {
            headers: JSON_HEADERS,
            data: Buffer.alloc(2 * MiB, 'a'),
        })
        expect(response.status()).toBe(413)
        expect(await response.json()).toMatchObject({
            code: 'VALIDATION_FAILED',
        })
        expect(response.headers()['x-request-id']).toBeTruthy()
        expect(await mockApi.requests()).toEqual([])
    })

    test('a chunked body over 1 MiB gets 413 and never reaches the API', async ({ baseURL }) => {
        const answer = await post(`${baseURL}/api/v1/applications`, {
            total: 2 * MiB,
            chunked: true,
        })
        expect(answer.status).toBe(413)
        expect(answer.body).toMatchObject({
            code: 'VALIDATION_FAILED',
        })
        expect(await mockApi.requests()).toEqual([])
    })

    test('a body of exactly 1 MiB is forwarded whole', async ({ request }) => {
        const prefix = '{"company":"Limit","vacancyText":"'
        const suffix = '"}'
        const data = prefix + 'a'.repeat(MiB - prefix.length - suffix.length) + suffix
        const response = await request.post('/api/v1/applications', {
            headers: JSON_HEADERS,
            data,
        })
        // Through the proxy; the API itself rejects a body this long.
        expect(response.status()).toBe(400)
        const [received] = await mockApi.requests()
        expect(received).toMatchObject({
            method: 'POST',
            bodyBytes: MiB,
        })
        expect(received?.headers['content-length']).toBe(String(MiB))
    })

    test('a normal POST still works', async ({ request }) => {
        const company = uniqueTitle('Proxied')
        const response = await request.post('/api/v1/applications', {
            data: {
                company,
                vacancyText: 'Through the proxy.',
            },
        })
        expect(response.status()).toBe(201)
        expect(await response.json()).toMatchObject({
            company,
        })
        expect(response.headers()['x-app-version']).toBe('e2e')
    })

    test('a body that arrives too slowly gets 408 at the body deadline', async ({ baseURL }) => {
        test.skip(!deadlines, 'the shortened deadlines are set on the bundled servers')
        // 1 byte every 200 ms: 100 bytes would take 20 s.
        const answer = await post(`${baseURL}/api/v1/applications`, {
            total: 100,
            chunked: true,
            chunkSize: 1,
            everyMs: 200,
        })
        expect(answer.status).toBe(408)
        expect(answer.ms).toBeGreaterThanOrEqual(BODY_TIMEOUT_MS - 50)
        expect(answer.ms).toBeLessThan(BODY_TIMEOUT_MS + 1500)
        expect(await mockApi.requests()).toEqual([])
    })

    test('an API that does not answer gets 504 at the upstream deadline', async ({ request }) => {
        test.skip(!deadlines, 'the shortened deadlines are set on the bundled servers')
        const started = performance.now()
        const response = await request.post('/api/v1/applications', {
            data: {
                company: '!slow',
            },
        })
        const ms = performance.now() - started
        expect(response.status()).toBe(504)
        expect(await response.json()).toMatchObject({
            code: 'INTERNAL',
        })
        expect(ms).toBeGreaterThanOrEqual(UPSTREAM_TIMEOUT_MS - 50)
        expect(ms).toBeLessThan(UPSTREAM_TIMEOUT_MS + 1500)
        // The proxy hung up on the API.
        await expect.poll(async () => (await mockApi.requests())[0]?.aborted).toBe(true)
    })

    test('a client that goes away aborts the API call', async ({ baseURL }) => {
        const body = JSON.stringify({
            company: '!slow',
        })
        const request = http.request(`${baseURL}/api/v1/applications`, {
            method: 'POST',
            headers: {
                ...JSON_HEADERS,
                'content-length': String(Buffer.byteLength(body)),
            },
        })
        request.on('error', () => {})
        request.end(body)
        await expect.poll(async () => (await mockApi.requests()).length).toBe(1)
        request.destroy()
        await expect.poll(async () => (await mockApi.requests())[0]?.aborted).toBe(true)
    })

    test("a client's identity headers never reach the API", async ({ request }) => {
        const response = await request.get('/api/v1/applications?limit=1', {
            headers: {
                authorization: 'Bearer forged',
                cookie: 'session=forged',
                'x-forwarded-for': '198.51.100.66',
                'x-forwarded-host': 'evil.example.com',
                'x-user-id': 'admin',
                'x-user-roles': 'admin',
                'accept-language': 'ru',
                'x-request-id': 'e2e-identity-check',
                // In production Traefik sets it (real-ip middleware) and drops the client's.
                'x-real-ip': '203.0.113.7',
            },
        })
        expect(response.status()).toBe(200)
        const [received] = await mockApi.requests()
        const headers = received?.headers ?? {}
        for (const name of [
            'authorization',
            'cookie',
            'x-forwarded-host',
            'x-user-id',
            'x-user-roles',
        ]) {
            expect(headers[name], name).toBeUndefined()
        }
        expect(headers['x-forwarded-for']).toBe('203.0.113.7')
        expect(headers['accept-language']).toBe('ru')
        expect(headers['x-request-id']).toBe('e2e-identity-check')
    })
})
