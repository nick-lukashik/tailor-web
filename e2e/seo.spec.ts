import { en, expect, NOINDEX_URL, test } from './fixtures'

test.describe('SEO and security', () => {
    test('the bare path is its own canonical (x-default)', async ({ page, baseURL }) => {
        await page.goto('/')
        const self = new RegExp(`^${baseURL}/?$`)
        await expect(page.locator('link[rel="canonical"]').first()).toHaveAttribute('href', self)
        await expect(page.locator('meta[property="og:url"]').first()).toHaveAttribute('content', self)
        await expect(page.locator('link[rel="alternate"][hreflang="x-default"]').first()).toHaveAttribute('href', self)
    })

    test('robots.txt allows the site and points at the sitemap', async ({ request, baseURL }) => {
        const response = await request.get('/robots.txt')
        expect(response.ok()).toBe(true)
        const text = await response.text()
        expect(text).toContain('Allow: /')
        expect(text).toContain('Disallow: /api/')
        expect(text).toContain(`Sitemap: ${baseURL}/sitemap.xml`)
    })

    test('sitemap.xml lists the home page per language and no applications', async ({ request, baseURL }) => {
        const response = await request.get('/sitemap.xml')
        expect(response.headers()['content-type']).toContain('xml')
        const xml = await response.text()
        expect(xml).toContain(`<loc>${baseURL}/?lang=en</loc>`)
        expect(xml).toContain(`<loc>${baseURL}/?lang=ru</loc>`)
        expect(xml).not.toContain('/applications')
    })

    test('applications are never indexed, even with ROBOTS=index', async ({ page }) => {
        for (const path of [
            '/applications',
            '/applications/application-045',
        ]) {
            await page.goto(`${path}?lang=en`)
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
        }
    })

    for (const { path, title, description } of [
        {
            path: '/',
            title: en.home.meta.title,
            description: en.home.meta.description,
        },
    ]) {
        test(`${path} has title, description, canonical, hreflang, Open Graph and JSON-LD`, async ({
            page,
            baseURL,
        }) => {
            const response = await page.goto(`${path}?lang=en`)
            await expect(page).toHaveTitle(title)
            const meta = (selector: string) => page.locator(selector).first()
            await expect(meta('meta[name="description"]')).toHaveAttribute('content', description)
            await expect(meta('link[rel="canonical"]')).toHaveAttribute(
                'href',
                `${baseURL}${path === '/' ? '/' : path}?lang=en`,
            )
            await expect(meta('link[rel="alternate"][hreflang="ru"]')).toHaveAttribute(
                'href',
                new RegExp(`${path === '/' ? '/' : path}\\?lang=ru$`),
            )
            await expect(meta('meta[property="og:title"]')).toHaveAttribute('content', title)
            await expect(meta('meta[property="og:image"]')).toHaveAttribute(
                'content',
                new RegExp(`^${baseURL}/opengraph-image`),
            )
            await expect(meta('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
            await expect(meta('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
            await expect(meta('link[rel="icon"]')).toHaveAttribute('href', /^\/icon/)
            // ROBOTS=index (the default): no robots meta at all.
            await expect(page.locator('meta[name="robots"]')).toHaveCount(0)

            const nonce = response?.headers()['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1]
            const jsonLd = page.locator('script[type="application/ld+json"]')
            // Browsers hide the nonce attribute after parsing; the property keeps it.
            expect(await jsonLd.evaluate(script => (script as HTMLScriptElement).nonce)).toBe(nonce)
            const data = JSON.parse((await jsonLd.textContent()) ?? '{}')
            expect(data['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual([
                'WebSite',
                'Organization',
            ])
        })
    }

    test('pages carry a nonce CSP without unsafe-inline scripts and security headers', async ({ page }) => {
        const response = await page.goto('/applications')
        const headers = response?.headers() ?? {}
        const csp = headers['content-security-policy'] ?? ''
        const scriptSrc = csp.split('; ').find(part => part.startsWith('script-src ')) ?? ''
        expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
        expect(scriptSrc).toContain("'strict-dynamic'")
        expect(scriptSrc).not.toContain('unsafe-inline')
        expect(csp, 'no unsafe-inline for styles either').not.toContain('unsafe-inline')
        expect(csp).toContain("frame-ancestors 'none'")
        expect(headers['x-content-type-options']).toBe('nosniff')
        expect(headers['x-frame-options']).toBe('DENY')
        expect(headers['x-app-version']).toBe('e2e')
        expect(headers['x-request-id']).toMatch(/^[\w-]{8,}$/)

        // Every script Next.js rendered carries this response's nonce.
        const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1]
        const nonces = await page
            .locator('script')
            .evaluateAll(scripts => scripts.map(script => (script as HTMLScriptElement).nonce))
        expect(nonces.length).toBeGreaterThan(0)
        expect(new Set(nonces)).toEqual(
            new Set([
                nonce,
            ]),
        )
    })

    test('health probes report the API', async ({ request }) => {
        const live = await request.get('/health/live')
        expect(await live.json()).toEqual({
            status: 'ok',
            version: 'e2e',
        })
        // The post-deploy smoke check waits for this header.
        expect(live.headers()['x-app-version']).toBe('e2e')
        const ready = await request.get('/health/ready')
        expect(ready.status()).toBe(200)
        expect(ready.headers()['x-app-version']).toBe('e2e')
        expect(await ready.json()).toMatchObject({
            status: 'ok',
            checks: {
                api: 'ok',
            },
        })
    })

    test('the /api proxy forwards to the backend and keeps contract errors', async ({ request }) => {
        const page = await request.get('/api/v1/applications?limit=2')
        expect(page.status()).toBe(200)
        expect((await page.json()).items).toHaveLength(2)

        const missing = await request.get('/api/v1/applications/nope')
        expect(missing.status()).toBe(404)
        expect(await missing.json()).toMatchObject({
            code: 'NOT_FOUND',
        })
        expect(missing.headers()['x-request-id']).toBeTruthy()

        const outside = await request.get('/api/internal/anything')
        expect(outside.status()).toBe(404)
    })
})

test.describe('ROBOTS=noindex, set at runtime on the same build', () => {
    test.skip(!NOINDEX_URL, 'needs a site started with ROBOTS=noindex (PW_NOINDEX_URL)')
    test.use({
        baseURL: NOINDEX_URL,
    })

    test('robots.txt disallows everything and has no sitemap', async ({ request }) => {
        const response = await request.get('/robots.txt')
        expect(response.ok()).toBe(true)
        const text = await response.text()
        expect(text).toContain('Disallow: /')
        expect(text).not.toContain('Allow:')
        expect(text).not.toContain('Sitemap:')
    })

    for (const path of [
        '/',
        '/applications',
    ]) {
        test(`${path} says noindex, nofollow`, async ({ page }) => {
            await page.goto(`${path}?lang=en`)
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
        })
    }
})
