import AxeBuilder from '@axe-core/playwright'
import { en, expect, mockApi, ru, test } from './fixtures'

// The mock API only (project chromium): its intake adds a `pending` vacancy,
// POST /__mock/vacancies/<id> reads it, then a CV and the messages are made
// (queued → generating → ready, MOCK_CV_MS each step). application-040 is
// ready to send (status new, CV and messages ready), on the first page.
const { stage, filters, messages, workspace, intake, list, detail } = en.applications
/** The pages ask again every 5 s while something is on its way. */
const POLLED = {
    timeout: 12_000,
}
const CV_URL = 'https://cv.example.com/application-040/Alex-Example-Senior-Engineer-CV.pdf'

test.use({
    permissions: [
        'clipboard-read',
        'clipboard-write',
    ],
})

test.describe('applying by hand', () => {
    test('add a vacancy, wait for its CV and messages, copy the e-mail, mark it sent, find it under Sent', async ({
        page,
        request,
        backend,
    }) => {
        const link = 'https://example.com/jobs/apply-flow'
        const stageChips = page.getByRole('group', {
            name: filters.label,
        })
        const rows = page.getByRole('list', {
            name: list.title,
        })
        const row = rows.getByRole('listitem').filter({
            // The mock leaves the row's company empty: it is named by the link's host.
            has: page.getByRole('link', {
                name: 'example.com',
                exact: true,
            }),
        })

        await test.step('add the vacancy: it is being read', async () => {
            await page.goto('/applications?lang=en')
            await page.getByLabel(intake.url).fill(link)
            await page
                .getByRole('button', {
                    name: intake.submit,
                })
                .click()
            await expect(page.getByText(intake.added)).toBeVisible()
            await expect(
                row.getByText(stage.reading, {
                    exact: true,
                }),
            ).toBeVisible()
        })

        const applications = await backend.allApplications()
        const added = applications.find(application => application.vacancyUrl === link)
        if (!added?.vacancyId) throw new Error('the vacancy was not added')

        await test.step('once read, its CV and messages are being made', async () => {
            const settled = await request.post(`${backend.url}/__mock/vacancies/${added.vacancyId}`, {
                data: {
                    parseStatus: 'parsed',
                },
            })
            expect(settled.status()).toBe(204)
            await page.goto(`/applications/${added.id}?lang=en`)
            await expect(
                page.getByText(stage.generating, {
                    exact: true,
                }),
            ).toBeVisible()
        })

        await test.step('ready to send: copy the e-mail body', async () => {
            await expect(
                page.getByText(stage.ready, {
                    exact: true,
                }),
            ).toBeVisible(POLLED)
            await expect(
                page.getByRole('tab', {
                    name: messages.email,
                    selected: true,
                }),
            ).toBeVisible()
            await page
                .getByRole('button', {
                    name: `Copy ${messages.body}`,
                })
                .click()
            await expect(page.getByText(`${messages.body} copied`)).toBeVisible()
            const copied = await page.evaluate(() => navigator.clipboard.readText())
            expect(copied).toContain(`https://cv.example.com/${added.id}/`)
            expect(copied).toContain('I am applying for the Senior backend engineer role at Example GmbH.')
        })

        await test.step('mark it as sent', async () => {
            await page
                .getByRole('button', {
                    name: workspace.markSent,
                })
                .click()
            await expect(page.getByText(workspace.markedSent)).toBeVisible()
            await expect(
                page.getByRole('button', {
                    name: en.applications.status.sent,
                    pressed: true,
                }),
            ).toBeVisible()
            await expect(
                page.getByRole('button', {
                    name: workspace.markSent,
                }),
            ).toHaveCount(0)
        })

        await test.step('it is under Sent, and the filter stays in the address', async () => {
            await page
                .getByRole('link', {
                    name: detail.back,
                })
                .click()
            await stageChips
                .getByRole('button', {
                    name: stage.sent,
                })
                .click()
            await expect(page).toHaveURL(/[?&]stage=sent/)
            await expect(
                row.getByText(stage.sent, {
                    exact: true,
                }),
            ).toBeVisible()
            await expect(
                rows.getByText(stage.ready, {
                    exact: true,
                }),
            ).toHaveCount(0)

            await page.reload()
            await expect(
                stageChips.getByRole('button', {
                    name: stage.sent,
                    pressed: true,
                }),
            ).toBeVisible()
            await expect(row).toBeVisible()
        })
    })

    test('a ready one: open the vacancy and the CV, copy the CV link, switch messages', async ({ page }) => {
        await page.goto('/applications/application-040?lang=en')
        await expect(
            page.getByRole('link', {
                name: detail.vacancyLink,
            }),
        ).toHaveAttribute('href', 'https://example.com/jobs/40')
        await expect(
            page.getByRole('link', {
                name: en.applications.cv.open,
            }),
        ).toHaveAttribute('href', CV_URL)

        // One on top, one at the apply form's file field.
        const copyCv = page.getByRole('button', {
            name: `Copy ${workspace.cvLink}`,
        })
        await expect(copyCv).toHaveCount(2)
        for (const button of await copyCv.all()) {
            await page.evaluate(() => navigator.clipboard.writeText(''))
            await button.click()
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CV_URL)
        }

        await page
            .getByRole('tab', {
                name: messages.linkedin,
            })
            .click()
        await expect(page.getByRole('tabpanel')).toContainText('would be glad to connect')
        await expect(page.getByRole('tabpanel')).toContainText(/\d+ \/ 300/)
        // Keyboard: the arrows move between the tabs.
        await page.keyboard.press('ArrowRight')
        await expect(
            page.getByRole('tab', {
                name: messages.coverLetter,
                selected: true,
            }),
        ).toBeFocused()
    })

    test('regenerates the messages, keeping the current ones until the new ones are ready', async ({ page }) => {
        await page.goto('/applications/application-040?lang=en')
        await page
            .getByRole('button', {
                name: messages.regenerate,
            })
            .click()
        await expect(page.getByText(messages.started)).toBeVisible()
        await expect(page.getByText(messages.generatingNewer)).toBeVisible()
        await expect(
            page.getByRole('tab', {
                name: messages.email,
            }),
        ).toBeVisible()
        await expect(page.getByText(messages.generatingNewer)).toHaveCount(0, POLLED)
        await expect(page.getByText(messages.version.replace('{version}', '2'))).toBeVisible()
    })

    test("shows the API's 409 in a toast", async ({ page, request, backend }) => {
        await page.goto('/applications/application-040?lang=en')
        // A version is queued behind the page's back: its button now gets a 409.
        const queued = await request.post(`${backend.url}/api/v1/applications/application-040/materials`)
        expect(queued.status()).toBe(202)
        await page
            .getByRole('button', {
                name: messages.regenerate,
            })
            .click()
        await expect(page.getByText('The materials of this application are already being written')).toBeVisible()
    })

    test('says the messages failed and tries again', async ({ page, request, backend }) => {
        const failed = await request.post(`${backend.url}/__mock/applications/application-040/materials`, {
            data: {
                status: 'failed',
                error: 'no_profile',
            },
        })
        expect(failed.status()).toBe(204)
        await page.goto('/applications/application-040?lang=en')
        await expect(page.getByText(messages.problem.noProfile)).toBeVisible()
        await expect(
            page.getByText(stage.failed, {
                exact: true,
            }),
        ).toBeVisible()
        await page
            .getByRole('button', {
                name: messages.retry,
            })
            .click()
        await expect(page.getByText(messages.started)).toBeVisible()
        const posts = (await mockApi.requests()).filter(
            call => call.method === 'POST' && call.path === '/api/v1/applications/application-040/materials',
        )
        expect(posts).toHaveLength(1)
    })

    test('a row ready to send opens its CV through the site and is marked sent from the list', async ({ page }) => {
        await page.goto('/applications?lang=en&stage=ready')
        const row = page.getByRole('listitem').filter({
            has: page.getByRole('link', {
                name: 'Seed company 40',
            }),
        })
        await expect(row).toHaveCount(1)
        const open = row.getByRole('link', {
            name: en.applications.cv.open,
        })
        await expect(open).toHaveAttribute('href', '/applications/application-040/cv')
        const redirect = await page.request.get('/applications/application-040/cv', {
            maxRedirects: 0,
        })
        expect(redirect.status()).toBe(307)
        expect(redirect.headers().location).toBe(CV_URL)

        await row
            .getByRole('button', {
                name: workspace.markSent,
            })
            .click()
        await expect(page.getByText(workspace.markedSent)).toBeVisible()
        // No longer ready to send: the chip's own filter shows it no more.
        await expect(row).toHaveCount(0)
        await expect(page.getByText(filters.empty.ready)).toBeVisible()
    })

    test('searches by company and keeps the query in the address', async ({ page }) => {
        await page.goto('/applications?lang=en')
        await page
            .getByRole('searchbox', {
                name: filters.search,
            })
            .fill('seed company 40')
        await expect(page).toHaveURL(/[?&]q=seed\+company\+40/)
        const items = page
            .getByRole('list', {
                name: list.title,
            })
            .getByRole('listitem')
        await expect(items).toHaveCount(1)
        await page
            .getByRole('searchbox', {
                name: filters.search,
            })
            .fill('no such company')
        await expect(page.getByText(filters.noMatch.replace('{query}', 'no such company'))).toBeVisible()
        await page
            .getByRole('button', {
                name: filters.showAll,
            })
            .click()
        await expect(items).toHaveCount(20)
    })

    for (const [lang, catalog] of [
        [
            'en',
            en,
        ],
        [
            'ru',
            ru,
        ],
    ] as const) {
        test(`the ready page has no axe violations in ${lang}`, async ({ page }) => {
            await page.goto(`/applications/application-040?lang=${lang}`)
            await expect(
                page.getByRole('tab', {
                    name: catalog.applications.messages.email,
                    exact: true,
                }),
            ).toBeVisible()
            const results = await new AxeBuilder({
                page,
            })
                .withTags([
                    'wcag2a',
                    'wcag2aa',
                    'wcag21a',
                    'wcag21aa',
                    'wcag22aa',
                ])
                .analyze()
            expect(results.violations).toEqual([])
        })
    }

    test('fits a 375 px screen without sideways scrolling', async ({ page }) => {
        await page.setViewportSize({
            width: 375,
            height: 812,
        })
        for (const path of [
            '/applications?lang=ru',
            '/applications/application-040?lang=ru',
        ]) {
            await page.goto(path)
            await page.locator('main').waitFor()
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            )
            expect(overflow, path).toBeLessThanOrEqual(0)
        }
    })
})
