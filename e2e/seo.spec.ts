import { en, expect, test } from './fixtures'

/** Nothing a crawler or a link preview can see may say what the site is for. */
const PURPOSE = /\bCV\b|résumé|resume|vacanc|cover letter|job|ваканс|резюме|работ/i

test.describe('SEO and security', () => {
    test('/ has nothing of its own: it leads to the applications', async ({ page, baseURL }) => {
        await page.goto('/')
        await expect(page).toHaveURL(`${baseURL}/applications`)
        const self = new RegExp(`^${baseURL}/applications$`)
        await expect(page.locator('link[rel="canonical"]').first()).toHaveAttribute('href', self)
        await expect(page.locator('meta[property="og:url"]').first()).toHaveAttribute('content', self)
        await expect(page.locator('link[rel="alternate"][hreflang="x-default"]').first()).toHaveAttribute('href', self)
    })

    test('robots.txt disallows everything and names no sitemap; there is none', async ({ request }) => {
        const response = await request.get('/robots.txt')
        expect(response.ok()).toBe(true)
        const text = await response.text()
        expect(text).toContain('Disallow: /')
        expect(text).not.toContain('Allow:')
        expect(text).not.toContain('Sitemap:')
        expect((await request.get('/sitemap.xml')).status()).toBe(404)
    })

    test('every page says noindex, nofollow', async ({ page }) => {
        for (const path of [
            '/applications',
            '/applications/application-045',
            '/profile',
            '/nowhere',
        ]) {
            await page.goto(`${path}?lang=en`)
            // A 404 also gets Next.js' own `noindex`.
            const robots = await page
                .locator('meta[name="robots"]')
                .evaluateAll(metas => metas.map(meta => meta.getAttribute('content')))
            expect(robots, path).toContain('noindex, nofollow')
        }
    })

    test('what link previews and installs read is neutral', async ({ page, request }) => {
        for (const lang of [
            'en',
            'ru',
        ]) {
            await page.goto(`/applications?lang=${lang}`)
            const meta = (selector: string) => page.locator(selector).first()
            for (const selector of [
                'meta[property="og:site_name"]',
                'meta[property="og:image:alt"]',
            ])
                expect(await meta(selector).getAttribute('content'), selector).not.toMatch(PURPOSE)
            const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}')
            expect(JSON.stringify(data), lang).not.toMatch(PURPOSE)
        }
        const manifest = await (await request.get('/manifest.webmanifest')).json()
        expect(manifest.name).toBe('Tailor')
        expect(JSON.stringify(manifest)).not.toMatch(PURPOSE)
        expect(en.meta.description).not.toMatch(PURPOSE)
        expect(en.meta.ogAlt).not.toMatch(PURPOSE)
    })

    test('a page has title, description, canonical, hreflang, Open Graph and JSON-LD', async ({ page, baseURL }) => {
        const path = '/applications'
        const title = `${en.applications.meta.title} · ${en.meta.siteName}`
        const response = await page.goto(`${path}?lang=en`)
        await expect(page).toHaveTitle(title)
        const meta = (selector: string) => page.locator(selector).first()
        await expect(meta('meta[name="description"]')).toHaveAttribute('content', en.applications.meta.description)
        await expect(meta('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}${path}?lang=en`)
        await expect(meta('link[rel="alternate"][hreflang="ru"]')).toHaveAttribute(
            'href',
            new RegExp(`${path}\\?lang=ru$`),
        )
        await expect(meta('meta[property="og:title"]')).toHaveAttribute('content', title)
        await expect(meta('meta[property="og:image"]')).toHaveAttribute(
            'content',
            new RegExp(`^${baseURL}/opengraph-image`),
        )
        await expect(meta('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
        await expect(meta('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
        await expect(meta('link[rel="icon"]')).toHaveAttribute('href', /^\/icon/)

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
