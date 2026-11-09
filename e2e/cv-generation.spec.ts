import { en, expect, mockApi, test } from './fixtures'

// The mock API only (project chromium): application-010 has a parsed vacancy and
// no CV; POST /applications/:id/cv makes one (queued → generating → ready).
const { cv } = en.applications
/** The page asks again every 5 s while a CV is made. */
const POLLED = {
    timeout: 12_000,
}
const CV_URL = 'https://cv.example.com/application-010/Alex-Example-Senior-Engineer-CV.pdf'

test.describe('CV of an application', () => {
    test('generates a CV, then links it with its details', async ({ page }) => {
        await page.goto('/applications/application-010?lang=en')
        await page
            .getByRole('button', {
                name: cv.generate,
            })
            .click()
        await expect(page.getByText(cv.generating)).toBeVisible()

        const open = page.getByRole('link', {
            name: cv.open,
        })
        await expect(open).toBeVisible(POLLED)
        await expect(open).toHaveAttribute('href', CV_URL)
        await expect(open).toHaveAttribute('target', '_blank')
        await expect(page.getByText('Version 1 · 2 pages · Made by mock-model')).toBeVisible()
        await expect(page.getByText(cv.generating)).toHaveCount(0)

        const posts = (await mockApi.requests()).filter(
            request => request.method === 'POST' && request.path === '/api/v1/applications/application-010/cv',
        )
        expect(posts).toHaveLength(1)
    })

    test('the list shows the CV state of a row', async ({ page, request, backend }) => {
        // A new vacancy is the first row; once read, tailor-api (and the mock) makes its first CV.
        const added = await request.post(`${backend.url}/api/v1/vacancies/intake`, {
            data: {
                items: [
                    {
                        url: 'https://example.com/jobs/cv-badge',
                        text: 'Backend engineer wanted.',
                    },
                ],
            },
        })
        expect(added.status()).toBe(200)
        const { items } = (await added.json()) as {
            items: {
                applicationId: string
                vacancyId: string
            }[]
        }
        const item = items[0]
        if (!item) throw new Error('nothing added')
        const settled = await request.post(`${backend.url}/__mock/vacancies/${item.vacancyId}`, {
            data: {
                parseStatus: 'parsed',
            },
        })
        expect(settled.status()).toBe(204)
        await expect
            .poll(async () => {
                const response = await request.get(`${backend.url}/api/v1/applications/${item.applicationId}`)
                return (
                    (await response.json()) as {
                        cv: {
                            status: string
                        }
                    }
                ).cv.status
            })
            .toBe('ready')

        await page.goto('/applications?lang=en')
        const row = page.getByRole('listitem').filter({
            // The mock leaves the row's company empty: it is named by the link's host.
            has: page.getByRole('link', {
                name: 'example.com',
                exact: true,
            }),
        })
        // The list asks again while the messages are written after the CV.
        await expect(row).toContainText(en.applications.stage.ready, POLLED)
        await expect(
            row.getByRole('link', {
                name: cv.open,
            }),
        ).toHaveAttribute('href', `/applications/${item.applicationId}/cv`)
    })

    test('generates again while the ready CV stays linked', async ({ page }) => {
        await page.goto('/applications/application-010?lang=en')
        await page
            .getByRole('button', {
                name: cv.generate,
            })
            .click()
        await page
            .getByRole('button', {
                name: cv.again,
            })
            .click({
                timeout: POLLED.timeout,
            })
        await expect(page.getByText(cv.generating)).toBeVisible()
        await expect(
            page.getByRole('link', {
                name: cv.open,
            }),
        ).toHaveAttribute('href', CV_URL)
        await expect(page.getByText('Version 2 · 2 pages · Made by mock-model')).toBeVisible(POLLED)
    })

    test('shows the API message of a 409', async ({ page, request, backend }) => {
        await page.goto('/applications/application-010?lang=en')
        // A version is queued behind the page's back: its button now gets a 409.
        const queued = await request.post(`${backend.url}/api/v1/applications/application-010/cv`)
        expect(queued.status()).toBe(202)
        await page
            .getByRole('button', {
                name: cv.generate,
            })
            .click()
        await expect(
            page.getByRole('alert').filter({
                hasText: 'A CV of this application is already being made',
            }),
        ).toBeVisible()
    })
})
