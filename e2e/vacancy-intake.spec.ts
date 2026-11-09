import { type Page } from '@playwright/test'
import { en, expect, mockApi, test } from './fixtures'

// The mock API only (project chromium): its intake adds `pending` applications
// with no company or role, and a link it already has is `existing`.
const { intake, stage, untitled } = en.applications

/** Picks a file through "Import file", as a person would; retried until the page has hydrated. */
async function importFile(page: Page, name: string, content: string) {
    await expect(async () => {
        const chooser = page.waitForEvent('filechooser', {
            timeout: 1_000,
        })
        await page
            .getByRole('button', {
                name: intake.import,
            })
            .click()
        await (await chooser).setFiles({
            name,
            mimeType: 'application/json',
            buffer: Buffer.from(content),
        })
    }).toPass()
}

test.describe('add vacancy', () => {
    test('adds a link, then says it is already in the list', async ({ page }) => {
        await page.goto('/applications?lang=en')
        const url = page.getByLabel(intake.url)
        const add = page.getByRole('button', {
            name: intake.submit,
        })

        await add.click()
        await expect(page.getByText(intake.emptySingle)).toBeVisible()

        await url.fill('https://www.example.com/jobs/intake-e2e')
        await add.click()
        await expect(page.getByText(intake.added)).toBeVisible()
        await expect(url).toHaveValue('')
        const newest = page
            .getByRole('list', {
                name: en.applications.list.title,
            })
            .getByRole('listitem')
            .first()
        await expect(newest.getByRole('link')).toHaveText('example.com')
        await expect(newest.getByText(stage.reading)).toBeVisible()

        await url.fill('https://www.example.com/jobs/intake-e2e')
        await add.click()
        await expect(page.getByText(intake.existing)).toBeVisible()
    })

    test('adds a pasted text as an untitled vacancy', async ({ page }) => {
        await page.goto('/applications?lang=en')
        await page.getByLabel(intake.text).fill('Engineer wanted.\n\nRemote.')
        await page
            .getByRole('button', {
                name: intake.submit,
            })
            .click()
        await expect(page.getByText(intake.added)).toBeVisible()
        await expect(
            page
                .getByRole('list', {
                    name: en.applications.list.title,
                })
                .getByRole('link', {
                    name: untitled,
                }),
        ).toHaveCount(1)
    })

    test('sends several links at once and shows what the API refused', async ({ page }) => {
        await page.goto('/applications?lang=en')
        await page
            .getByRole('button', {
                name: intake.toBatch,
            })
            .click()
        const links = page.getByLabel(intake.links)
        const add = page.getByRole('button', {
            name: intake.submit,
        })

        await links.fill(
            'https://example.com/jobs/2\n\nhttps://example.com/jobs/new-1\nhttps://example.com/jobs/new-2\n',
        )
        await add.click()
        // Seed application 2 has https://example.com/jobs/2.
        await expect(page.getByText('2 added, 1 already in your list.')).toBeVisible()
        await expect(links).toHaveValue('')

        await links.fill('https://example.com/jobs/new-3\nnot a link')
        await add.click()
        await expect(page.getByText('Link 2: Invalid URL')).toBeVisible()
    })

    test('imports a JSON file in requests of at most 200 and sums them up', async ({ page }) => {
        await page.goto('/applications?lang=en')
        const items = [
            // Seed application 2 has this link.
            {
                url: 'https://example.com/jobs/2',
            },
            ...Array.from(
                {
                    length: 249,
                },
                (_, index) => ({
                    url: `https://example.com/jobs/import-${index}`,
                    text: 'Engineer wanted.',
                }),
            ),
        ]
        await importFile(
            page,
            'vacancies.json',
            JSON.stringify({
                items,
            }),
        )
        await expect(page.getByText('249 added, 1 already in your list.')).toBeVisible({
            timeout: 10_000,
        })
        const posts = (await mockApi.requests()).filter(
            request => request.method === 'POST' && request.path === '/api/v1/vacancies/intake',
        )
        expect(posts).toHaveLength(2)
        await expect(
            page
                .getByRole('list', {
                    name: en.applications.list.title,
                })
                .getByRole('listitem')
                .first()
                .getByText(stage.reading),
        ).toBeVisible()
    })

    test('refuses a file with bad items and sends nothing', async ({ page }) => {
        await page.goto('/applications?lang=en')
        await importFile(
            page,
            'vacancies.json',
            JSON.stringify({
                items: [
                    {
                        url: 'https://example.com/jobs/fine',
                    },
                    {
                        url: 'not a link',
                    },
                ],
            }),
        )
        await expect(
            page.getByText('Nothing was sent. 1 vacancy has a problem: item 2 has an invalid link.'),
        ).toBeVisible()
        await importFile(page, 'notes.json', 'not json')
        await expect(page.getByText(intake.importProblem.notJson)).toBeVisible()
        const posts = (await mockApi.requests()).filter(request => request.path === '/api/v1/vacancies/intake')
        expect(posts).toHaveLength(0)
    })
})
