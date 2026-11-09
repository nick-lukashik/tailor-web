import { en, expect, test } from './fixtures'

// The mock API only (project chromium): its seed has a parsed vacancy
// (application-010), one without a text (009) and one that failed with a text
// (007); POST /__mock/vacancies/<id> settles a pending one.
const { vacancy: text, detail, cv } = en.applications
/** The page asks again every 5 s while a vacancy is being read. */
const POLLED = {
    timeout: 12_000,
}

test.describe('vacancy on the application page', () => {
    test('shows what was read from the vacancy', async ({ page }) => {
        await page.goto('/applications/application-010?lang=en')
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: 'Seed company 10',
            }),
        ).toBeVisible()
        await expect(page.getByText('Seed role 10 at Seed company 10: backend in TypeScript')).toBeVisible()
        await expect(page.getByText(detail.model.replace('{model}', 'mock-model'))).toBeVisible()

        const facts = page.getByRole('definition')
        await expect(facts.getByText(text.remote.hybrid)).toBeVisible()
        await expect(facts.getByText('Berlin, Germany')).toBeVisible()
        await expect(facts.getByText('€60,000–€80,000 a year')).toBeVisible()
        await expect(facts.getByText('English')).toBeVisible()

        await expect(
            page.getByRole('listitem').filter({
                hasText: 'TypeScript',
            }),
        ).toContainText(text.requiredSkill)
        await expect(page.getByText('Five years of backend work')).toBeVisible()
        // An empty list is not shown.
        await expect(page.getByText(text.niceToHave)).toHaveCount(0)

        await expect(
            page.getByRole('link', {
                name: 'jobs@example.com',
            }),
        ).toHaveAttribute('href', 'mailto:jobs@example.com')
        await expect(
            page.getByRole('link', {
                name: '@example_jobs',
            }),
        ).toHaveAttribute('href', 'https://t.me/example_jobs')
        await expect(
            page.getByRole('link', {
                name: 'https://jobs.example.com/apply',
            }),
        ).toHaveAttribute('href', 'https://jobs.example.com/apply')

        // Read before CVs were made: no CV yet, one can be asked for.
        await expect(
            page.getByRole('button', {
                name: cv.generate,
            }),
        ).toBeVisible()
        await expect(
            page.getByRole('link', {
                name: cv.open,
            }),
        ).toHaveCount(0)
    })

    test('says there is no text to read', async ({ page }) => {
        await page.goto('/applications/application-009?lang=en')
        await expect(page.getByText(text.noText)).toBeVisible()
        await expect(page.getByText(detail.originalText)).toHaveCount(0)
    })

    test('reads a failed vacancy again', async ({ page }) => {
        await page.goto('/applications/application-007?lang=en')
        await expect(page.getByText(text.failed)).toBeVisible()
        await page
            .getByRole('button', {
                name: text.readAgain,
            })
            .click()
        await expect(page.getByText('Senior backend engineer at Example GmbH')).toBeVisible(POLLED)
        await expect(page.getByText(text.failed)).toHaveCount(0)
        // A vacancy just read gets its first CV, as tailor-api queues it.
        await expect(
            page.getByRole('link', {
                name: cv.open,
            }),
        ).toBeVisible(POLLED)
    })

    test('waits while the vacancy is read, then shows it', async ({ page, request, backend }) => {
        const added = await request.post(`${backend.url}/api/v1/vacancies/intake`, {
            data: {
                items: [
                    {
                        url: 'https://example.com/jobs/polled',
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

        await page.goto(`/applications/${item.applicationId}?lang=en`)
        await expect(page.getByText(text.pending)).toBeVisible()
        const settled = await request.post(`${backend.url}/__mock/vacancies/${item.vacancyId}`, {
            data: {
                parseStatus: 'parsed',
            },
        })
        expect(settled.status()).toBe(204)
        await expect(page.getByText('Senior backend engineer at Example GmbH')).toBeVisible(POLLED)
        await expect(page.getByText(text.pending)).toHaveCount(0)
        // The header takes the company and the role from the vacancy.
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: 'Example GmbH',
            }),
        ).toBeVisible()

        await page.getByText(detail.originalText).click()
        await expect(page.getByText('Backend engineer wanted.')).toBeVisible()
    })
})
