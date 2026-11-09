import { en, expect, ru, test, uniqueTitle } from './fixtures'

// Runs in two projects: chromium (the mock API, reset to its 45 seed
// applications before each test) and real-api (E2E_API_URL, whatever data is
// there). So the expectations come from the API itself or from applications
// the test creates through the API (the site itself does not write yet).

const { list: listText, detail } = en.applications
const PAGE_SIZE = 20

test.describe('applications', () => {
    test('renders the first page on the server and loads more with the cursor', async ({ page, request, backend }) => {
        // Three pages at least: 20 + 20 + the rest.
        await backend.ensureApplications(2 * PAGE_SIZE + 5)
        const applications = await backend.allApplications()
        const newest = applications[0]
        if (!newest) throw new Error('no applications')
        const newestHref = `/applications/${encodeURIComponent(newest.id)}`

        const html = await (await request.get('/applications?lang=en')).text()
        expect(html).toContain(`href="${newestHref}"`)

        await page.goto('/applications?lang=en')
        const list = page.getByRole('list', {
            name: listText.title,
        })
        const items = list.getByRole('listitem')
        await expect(items).toHaveCount(PAGE_SIZE)
        // Newest first.
        await expect(items.first().getByRole('link')).toHaveAttribute('href', newestHref)

        const loadMore = page.getByRole('button', {
            name: listText.loadMore,
        })
        for (let shown = PAGE_SIZE; shown < applications.length; ) {
            await loadMore.click()
            shown = Math.min(shown + PAGE_SIZE, applications.length)
            await expect(items).toHaveCount(shown)
        }
        await expect(page.getByText(listText.end)).toBeVisible()
        await expect(loadMore).toHaveCount(0)
    })

    test('the application page shows the vacancy, its status and that there is no CV yet', async ({
        page,
        backend,
    }) => {
        const application = await backend.create({
            company: uniqueTitle('Company'),
            role: 'Engineer',
            vacancyUrl: 'https://example.com/jobs/e2e',
            vacancyText: 'Written by Playwright for the application page.',
        })
        await page.goto(`/applications/${encodeURIComponent(application.id)}?lang=en`)
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: application.company,
            }),
        ).toBeVisible()
        await expect(page).toHaveTitle(`${application.company}: Engineer · ${en.meta.siteName}`)
        await expect(page.getByText(en.applications.status.new)).toBeVisible()
        // The text sits in "Original text", closed until asked for.
        const text = page.getByText('Written by Playwright for the application page.')
        await expect(text).toBeHidden()
        await page.getByText(detail.originalText).click()
        await expect(text).toBeVisible()

        const vacancy = page.getByRole('link', {
            name: detail.vacancyLink,
        })
        await expect(vacancy).toHaveAttribute('href', 'https://example.com/jobs/e2e')
        await expect(vacancy).toHaveAttribute('rel', 'noopener noreferrer')
        // No CV is made yet: the page says so and links nowhere.
        await expect(page.getByText(en.applications.cv.none)).toBeVisible()
        await expect(
            page.getByRole('link', {
                name: en.applications.cv.open,
            }),
        ).toHaveCount(0)

        await page
            .getByRole('link', {
                name: detail.back,
            })
            .click()
        await expect(page).toHaveURL(/\/applications$/)
    })

    test('an application without a link or text says so', async ({ page, backend }) => {
        const application = await backend.create({
            company: uniqueTitle('Bare'),
        })
        await page.goto(`/applications/${encodeURIComponent(application.id)}?lang=en`)
        await expect(page.getByText(detail.emptyVacancyText)).toBeVisible()
        await expect(
            page.getByRole('link', {
                name: detail.vacancyLink,
            }),
        ).toHaveCount(0)
    })

    test('a missing application answers 404 with the not-found page', async ({ page }) => {
        const response = await page.goto('/applications/does-not-exist?lang=en')
        expect(response?.status()).toBe(404)
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: en.notFound.title,
            }),
        ).toBeVisible()
        // Next.js' own 404 noindex, next to the noindex of every applications page.
        await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1)
    })

    test("an unknown address answers 404 in the reader's language", async ({ page }) => {
        const response = await page.goto('/nowhere?lang=ru')
        expect(response?.status()).toBe(404)
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: ru.notFound.title,
            }),
        ).toBeVisible()
    })
})
