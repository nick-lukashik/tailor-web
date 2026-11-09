import { en, expect, test } from './fixtures'

// The mock API only (project chromium): its intake adds `pending` applications
// with no company or role, and a link it already has is `existing`.
const { intake, parse, untitled } = en.applications

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
        await expect(newest.getByText(parse.pending)).toBeVisible()

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
})
