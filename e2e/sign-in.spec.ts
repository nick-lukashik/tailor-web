import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { en, expect, mockApi, test } from './fixtures'
import { ID_PORT, SSO_HOME_URL, SSO_PORT } from './servers'

// The site with accounts on (as prod) against e2e/mock-id.mjs and the mock API:
// only a session whose token carries the `tailor` role gets anything; everyone else
// is sent to HOME_URL with nothing rendered. The token through the /api proxy, the profile.

const SSO_URL = `http://127.0.0.1:${SSO_PORT}`
const ID_URL = `http://127.0.0.1:${ID_PORT}`
const AWAY = new RegExp(`^${SSO_HOME_URL.replaceAll('.', '\\.')}$`)
const WCAG = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
]
/** Every kind of path the site serves but the public ones (robots.txt, the probes). */
const GATED = [
    '/',
    '/applications',
    '/applications/application-010',
    '/profile',
    '/nowhere',
    '/auth/error',
    '/manifest.webmanifest',
    '/opengraph-image',
    '/icon',
]

test.skip(Boolean(process.env.PW_BASE_URL), 'needs the mock account site of playwright.config.ts')
test.use({
    baseURL: SSO_URL,
})

/** Signed in at the account site as `email` (the session cookie is set), without opening this site. */
async function signIn(context: BrowserContext, email: string) {
    await context.addCookies([
        {
            name: 'e2e_email',
            value: encodeURIComponent(email),
            url: ID_URL,
        },
    ])
    const response = await context.request.get(`${ID_URL}/login?continue=${encodeURIComponent(SSO_URL)}`, {
        maxRedirects: 0,
    })
    expect(response.status()).toBe(303)
}

/** Signed in at the account site as `email`, and on `path` of this site. */
async function signedIn(page: Page, context: BrowserContext, email: string, path = '/applications?lang=en') {
    await context.addCookies([
        {
            name: 'e2e_email',
            value: encodeURIComponent(email),
            url: ID_URL,
        },
    ])
    await page.goto(`${ID_URL}/login?continue=${encodeURIComponent(`${SSO_URL}${path}`)}`)
    await expect(page).toHaveURL(`${SSO_URL}${path}`)
}

async function account(page: Page, email: string) {
    const response = await page.request.get(`${ID_URL}/test/sessions?email=${encodeURIComponent(email)}`)
    return (await response.json()) as {
        userId: string
        live: number
        refreshes: number
        /** Access tokens in the order they were issued. */
        issued: string[]
    }
}

/** `sub` of the (unsigned, JWT-shaped) mock token in an Authorization header. */
const subjectOf = (authorization: string | string[] | undefined) => {
    const payload = /^Bearer [\w-]+\.([\w-]+)\.[\w-]+$/.exec(String(authorization ?? ''))?.[1]
    return payload
        ? (
              JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
                  sub: string
              }
          ).sub
        : undefined
}

const header = (page: Page) => page.getByRole('banner')
const sessionCookie = async (context: BrowserContext) =>
    (await context.cookies(SSO_URL)).find(cookie => cookie.name === 'nl_session')

/** Every gated path answers a bare 307 to the landing; /api a bare 404; the API hears nothing. */
async function expectNothingHere(request: APIRequestContext) {
    for (const path of GATED) {
        const response = await request.get(`${path}?lang=en`, {
            maxRedirects: 0,
        })
        expect(response.status(), path).toBe(307)
        expect(response.headers().location, path).toMatch(AWAY)
        expect(response.headers()['cache-control'], path).toContain('no-store')
        // Next.js writes the target as the body of a redirect; nothing else.
        expect([
            '',
            response.headers().location,
        ]).toContain(await response.text())
    }
    for (const method of [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
    ]) {
        const response = await request.fetch('/api/v1/profile', {
            method,
            headers: {
                origin: SSO_URL,
            },
            ...(method === 'GET'
                ? {}
                : {
                      data: {},
                  }),
        })
        expect(response.status(), method).toBe(404)
        expect(await response.json()).toMatchObject({
            code: 'NOT_FOUND',
            message: 'Not found',
        })
    }
    expect((await request.get('/api/v1/me')).status()).toBe(404)
    expect(await mockApi.requests()).toEqual([])
}

test.describe('without access', () => {
    test('without a session: every page is a bare redirect to the landing, /api a 404', async ({ request }) => {
        await expectNothingHere(request)
        // What stays public says nothing.
        const robots = await request.get('/robots.txt')
        expect(robots.status()).toBe(200)
        expect(await robots.text()).toContain('Disallow: /')
        expect((await request.get('/health/live')).status()).toBe(200)
    })

    test('a browser lands on the landing with no word of this site', async ({ page }) => {
        for (const path of [
            '/',
            '/profile?lang=en',
        ]) {
            await page.goto(path)
            await expect(page).toHaveURL(AWAY)
            await expect(page).toHaveTitle('Landing')
        }
    })

    test('signed in without the tailor role: the same, and the shared session stays', async ({ context }) => {
        const email = `guest-${randomUUID()}@example.com`
        await signIn(context, email)
        const cookie = await sessionCookie(context)
        expect(cookie).toBeDefined()
        await expectNothingHere(context.request)
        // Still signed in to every other site: only Tailor is closed.
        expect((await sessionCookie(context))?.value).toBe(cookie?.value)
    })

    test('a session that ended elsewhere: away, and the cookie goes', async ({ context }) => {
        const email = `e2e-${randomUUID()}@example.com`
        await signIn(context, email)
        await context.request.post(`${ID_URL}/test/revoke`, {
            data: {
                email,
            },
        })
        const response = await context.request.get('/applications?lang=en', {
            headers: {
                accept: 'text/html',
            },
            maxRedirects: 0,
        })
        expect(response.status()).toBe(307)
        expect(response.headers().location).toMatch(AWAY)
        expect(await sessionCookie(context)).toBeUndefined()
    })
})

test.describe('signed in', () => {
    test('with the role: / leads to the applications; the header shows the person and "Sign out"', async ({
        page,
        context,
    }) => {
        const email = `e2e-${randomUUID()}@example.com`
        await signIn(context, email)
        await page.goto('/?lang=en')
        await expect(page).toHaveURL(`${SSO_URL}/applications`)
        await expect(header(page).getByText(email)).toBeVisible()
        await expect(page.getByText('Seed company 45')).toBeVisible()
        const html = await page.content()
        for (const token of (await account(page, email)).issued) expect(html).not.toContain(token)
        const results = await new AxeBuilder({
            page,
        })
            .withTags(WCAG)
            .analyze()
        expect(results.violations).toEqual([])

        await header(page)
            .getByRole('button', {
                name: en.nav.signOut,
            })
            .click()
        // Signed out, nothing is left here for this person.
        await expect(page).toHaveURL(AWAY)
        expect((await account(page, email)).live).toBe(0)
        expect(await sessionCookie(context)).toBeUndefined()
    })

    test('pages and /api send the access token to the API, never the cookie', async ({ page, context }) => {
        const email = `e2e-${randomUUID()}@example.com`
        await signedIn(page, context, email)
        const { userId } = await account(page, email)
        await expect(page.getByText('Seed company 45')).toBeVisible()
        await page
            .getByRole('button', {
                name: en.applications.list.loadMore,
            })
            .click()
        await expect(page.getByText('Seed company 25')).toBeVisible()

        const requests = await mockApi.requests()
        const listed = requests.filter(request => request.path === '/api/v1/applications')
        // The server's prefetch, then the browser's next page through /api.
        expect(listed.length).toBeGreaterThanOrEqual(2)
        for (const request of requests) {
            expect(subjectOf(request.headers.authorization), request.path).toBe(userId)
            expect(request.headers.cookie, request.path).toBeUndefined()
        }
    })

    test('a cross-site write is refused, even with the session', async ({ page, context }) => {
        await signedIn(page, context, `e2e-${randomUUID()}@example.com`)
        for (const headers of [
            {
                origin: 'https://elsewhere.example',
            } as Record<string, string>,
            {
                'sec-fetch-site': 'same-site',
            },
        ]) {
            const response = await page.request.put('/api/v1/profile', {
                headers,
                data: {},
            })
            expect(response.status()).toBe(403)
            expect(await response.json()).toMatchObject({
                code: 'FORBIDDEN',
            })
        }
        expect((await mockApi.requests()).filter(request => request.path === '/api/v1/profile')).toEqual([])
    })

    test('an expiring token is refreshed before the page, and the page already sends the new one', async ({
        page,
        context,
    }) => {
        const email = `short-${randomUUID()}@example.com`
        await signedIn(page, context, email)
        await expect(page.getByText('Seed company 45')).toBeVisible()
        const first = await account(page, email)
        expect(first.refreshes).toBeGreaterThanOrEqual(1)
        const [fromLogin, refreshed] = first.issued
        const [render] = (await mockApi.requests()).filter(request => request.path === '/api/v1/applications')
        // The cookie the request came with held the token of the sign-in; the page used the refreshed one.
        expect(render?.headers.authorization).toBe(`Bearer ${refreshed}`)
        expect(render?.headers.authorization).not.toBe(`Bearer ${fromLogin}`)

        await page.reload()
        await expect(page.getByText('Seed company 45')).toBeVisible()
        expect((await account(page, email)).refreshes).toBeGreaterThan(first.refreshes)
    })
})

test.describe('profile', () => {
    const text = en.profileEditor
    const editor = (page: Page) =>
        page.getByRole('textbox', {
            name: text.label,
        })
    const save = (page: Page) =>
        page.getByRole('button', {
            name: text.save,
        })

    test('starts from {}, saves, shows the stored document and its version', async ({ page, context }) => {
        await signedIn(page, context, `e2e-${randomUUID()}@example.com`, '/profile?lang=en')
        await expect(page.getByText(text.empty.replace("'{}'", '{}'))).toBeVisible()
        await expect(editor(page)).toHaveValue('{}')

        await editor(page).fill('{"person": {"email": "alex@example.com"}}')
        await save(page).click()
        await expect(page.getByText('Saved: version 1')).toBeVisible()
        await expect(
            page.getByText('Version 1', {
                exact: true,
            }),
        ).toBeVisible()
        // The stored document: every section, as the API keeps it.
        await expect(editor(page)).toHaveValue(/"cases"/)

        await page.reload()
        await expect(editor(page)).toHaveValue(/alex@example\.com/)
        const results = await new AxeBuilder({
            page,
        })
            .withTags(WCAG)
            .analyze()
        expect(results.violations).toEqual([])
    })

    test('shows what the API refused, by path, and what is not JSON', async ({ page, context }) => {
        await signedIn(page, context, `e2e-${randomUUID()}@example.com`, '/profile?lang=en')
        await editor(page).fill('{"persn": {}, "person": {"email": "nope"}}')
        await save(page).click()
        // Next.js has an empty alert of its own, the route announcer.
        const alert = page.getByRole('alert').filter({
            hasText: /./,
        })
        await expect(alert).toContainText(text.rejected)
        await expect(alert).toContainText(`${text.documentPath}: Unrecognized key: "persn"`)
        await expect(alert).toContainText('person.email: Invalid email address')

        await editor(page).fill('{"person": ')
        await save(page).click()
        await expect(alert).toContainText(text.invalidJson.split(':')[0] ?? '')
        expect((await mockApi.requests()).filter(request => request.method === 'PUT')).toHaveLength(1)
    })

    test('offers the master CV once saved: a PDF through /api with the token, in a new tab', async ({
        page,
        context,
    }) => {
        await signedIn(page, context, `e2e-${randomUUID()}@example.com`, '/profile?lang=en')
        const masterCv = page.getByRole('link', {
            name: text.masterCv,
        })
        await expect(editor(page)).toHaveValue('{}')
        await expect(masterCv).toHaveCount(0)

        await editor(page).fill('{"person": {"email": "alex@example.com"}}')
        await save(page).click()
        await expect(page.getByText('Saved: version 1')).toBeVisible()
        await expect(masterCv).toHaveAttribute('href', '/api/v1/profile/cv.pdf')
        await expect(masterCv).toHaveAttribute('target', '_blank')
        await expect(masterCv).toHaveAccessibleDescription(text.masterCvHint)

        // Headless Chromium has no PDF viewer: the new tab only loads the file.
        const opened = page.waitForEvent('popup')
        const loaded = context.waitForEvent('response', answer => answer.url() === `${SSO_URL}/api/v1/profile/cv.pdf`)
        await masterCv.click()
        await opened
        const answer = await loaded
        expect(answer.status()).toBe(200)
        expect(answer.headers()['content-type']).toBe('application/pdf')

        // The proxied answer: the bytes and the headers that name the file.
        const response = await page.request.get('/api/v1/profile/cv.pdf')
        expect(response.status()).toBe(200)
        expect(response.headers()['content-type']).toBe('application/pdf')
        expect(response.headers()['content-disposition']).toBe('inline; filename="Alex-Example-Senior-Engineer-CV.pdf"')
        expect(response.headers()['cache-control']).toBe('private, no-store')
        const body = await response.body()
        expect(body.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
        expect(body.subarray(-6).toString('latin1')).toBe('%%EOF\n')

        const pdfCalls = (await mockApi.requests()).filter(request => request.path === '/api/v1/profile/cv.pdf')
        expect(pdfCalls.length).toBeGreaterThanOrEqual(1)
        for (const call of pdfCalls) {
            expect(subjectOf(call.headers.authorization)).toBeDefined()
            expect(call.headers.cookie).toBeUndefined()
        }
    })

    test('uploads a JSON file into the editor and downloads it again', async ({ page, context }, testInfo) => {
        await signedIn(page, context, `e2e-${randomUUID()}@example.com`, '/profile?lang=en')
        const file = testInfo.outputPath('profile.json')
        writeFileSync(file, '{"settings": {"maxPages": 2}}')
        await page
            .getByLabel(text.upload, {
                exact: true,
            })
            .setInputFiles(file)
        await expect(editor(page)).toHaveValue('{"settings": {"maxPages": 2}}')
        await expect(page.getByText('Loaded profile.json. Save to keep it.')).toBeVisible()

        const download = page.waitForEvent('download')
        await page
            .getByRole('button', {
                name: text.download,
            })
            .click()
        const saved = await download
        expect(saved.suggestedFilename()).toBe('tailor-profile.json')
    })
})
