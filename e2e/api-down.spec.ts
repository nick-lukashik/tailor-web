import { API_DOWN_URL, en, expect, test } from './fixtures'

// The same build with an API that does not answer (playwright.config.ts).
// Service contract, kind web: readiness reports the API, it does not require it.

test.describe('API down', () => {
    test.skip(!API_DOWN_URL, 'needs the bundled servers (not with PW_BASE_URL)')
    test.use({
        baseURL: API_DOWN_URL,
    })

    test('/health/ready stays 200 and reports the API as down', async ({ request }) => {
        const ready = await request.get('/health/ready')
        expect(ready.status()).toBe(200)
        expect(ready.headers()['x-app-version']).toBe('e2e')
        expect(await ready.json()).toMatchObject({
            status: 'degraded',
            checks: {
                api: 'down',
            },
        })
    })

    test('a page that needs no API still renders', async ({ page }) => {
        const response = await page.goto('/?lang=en')
        expect(response?.status()).toBe(200)
        await expect(
            page.getByRole('heading', {
                level: 1,
            }),
        ).toBeVisible()
    })

    test('the applications page shows its error state', async ({ page }) => {
        const response = await page.goto('/applications?lang=en')
        expect(response?.status()).toBe(200)
        // After the client's retries (src/lib/query/get-query-client.ts).
        const failed = page.getByRole('alert').filter({
            hasText: en.applications.list.error,
        })
        await expect(failed).toBeVisible({
            timeout: 15_000,
        })
        await expect(
            failed.getByRole('button', {
                name: en.applications.list.retry,
            }),
        ).toBeVisible()
    })

    test('/api answers 503 with the contract error', async ({ request }) => {
        const response = await request.get('/api/v1/applications')
        expect(response.status()).toBe(503)
        expect(await response.json()).toMatchObject({
            code: 'INTERNAL',
        })
    })
})
