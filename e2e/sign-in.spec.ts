import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { type BrowserContext, type Page } from '@playwright/test'
import { en, expect, mockApi, test } from './fixtures'
import { ID_PORT, SSO_PORT } from './servers'

// The site with accounts on (as prod) against e2e/mock-id.mjs and the mock API:
// private pages, the token through the /api proxy, the invitation page, the profile.

const SSO_URL = `http://127.0.0.1:${SSO_PORT}`
const ID_URL = `http://127.0.0.1:${ID_PORT}`
const WCAG = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
]

test.skip(Boolean(process.env.PW_BASE_URL), 'needs the mock account site of playwright.config.ts')
test.use({
    baseURL: SSO_URL,
})

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

const header = (page: Page) => page.getByRole('banner')
const signInLink = (page: Page) =>
    header(page).getByRole('link', {
        name: en.nav.signIn,
    })
const sessionCookie = async (context: BrowserContext) =>
    (await context.cookies(SSO_URL)).find(cookie => cookie.name === 'nl_session')

test.describe('signed out', () => {
    test('the home page is open; every other page offers to sign in, back to it', async ({ page }) => {
        await page.goto('/?lang=en')
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: en.home.heading,
            }),
        ).toBeVisible()
        await expect(signInLink(page)).toBeVisible()

        for (const path of [
            '/applications',
            '/applications/application-010',
            '/profile',
        ]) {
            await page.goto(`${path}?lang=en`)
            await expect(
                page.getByRole('heading', {
                    level: 1,
                    name: en.access.signIn.title,
                }),
            ).toBeVisible()
            await expect(
                page.getByRole('main').getByRole('link', {
                    name: en.access.signIn.action,
                }),
            ).toHaveAttribute('href', `${ID_URL}/login?continue=${encodeURIComponent(`${SSO_URL}${path}`)}`)
            await expect(page.getByText('Seed company 10')).toHaveCount(0)
        }
        const results = await new AxeBuilder({
            page,
        })
            .withTags(WCAG)
            .analyze()
        expect(results.violations).toEqual([])
        // Nothing private was asked for without a session.
        expect((await mockApi.requests()).map(request => request.path)).toEqual([])
    })

    test('a write through /api needs a session and never reaches the API', async ({ request }) => {
        for (const method of [
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
                data: {},
            })
            expect(response.status(), method).toBe(401)
            expect(await response.json()).toMatchObject({
                code: 'UNAUTHORIZED',
            })
        }
        expect(await mockApi.requests()).toEqual([])
    })
})

test.describe('signed in', () => {
    test('"Sign in" comes back signed in; the header shows the person and "Sign out"', async ({ page, context }) => {
        const email = `e2e-${randomUUID()}@example.com`
        await context.addCookies([
            {
                name: 'e2e_email',
                value: encodeURIComponent(email),
                url: ID_URL,
            },
        ])
        await page.goto('/applications?lang=en')
        await page
            .getByRole('main')
            .getByRole('link', {
                name: en.access.signIn.action,
            })
            .click()
        await expect(page).toHaveURL(`${SSO_URL}/applications`)
        await expect(header(page).getByText(email)).toBeVisible()
        await expect(page.getByText('Seed company 45')).toBeVisible()
        expect(await page.content()).not.toMatch(/at\.[0-9a-f]{8}-/)

        await header(page)
            .getByRole('button', {
                name: en.nav.signOut,
            })
            .click()
        await expect(signInLink(page)).toBeVisible()
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
            expect(request.headers.authorization, request.path).toMatch(new RegExp(`^Bearer at\\.${userId}\\.`))
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

test.describe('by invitation', () => {
    test('a person not on the list sees the invitation page with their user id', async ({ page, context }) => {
        const email = `guest-${randomUUID()}@example.com`
        await signedIn(page, context, email, '/profile?lang=en')
        const { userId } = await account(page, email)
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: en.access.invite.title,
            }),
        ).toBeVisible()
        await expect(page.getByLabel(en.access.invite.idLabel)).toHaveValue(userId)
        await expect(
            page.getByRole('textbox', {
                name: en.profileEditor.label,
            }),
        ).toHaveCount(0)

        await page.goto('/applications?lang=en')
        await expect(page.getByLabel(en.access.invite.idLabel)).toHaveValue(userId)
        await expect(page.getByText('Seed company 45')).toHaveCount(0)
        const results = await new AxeBuilder({
            page,
        })
            .withTags(WCAG)
            .analyze()
        expect(results.violations).toEqual([])
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
