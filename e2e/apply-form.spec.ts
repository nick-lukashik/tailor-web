import { type Page } from '@playwright/test'
import { en, expect, test } from './fixtures'

// The mock API only (project chromium): application-040 has an apply form read
// from its page (MOCK_FORM) and the answers in its messages; 012's page could
// not be read, and POST /api/v1/vacancies/<id>/fetch reads it again with the form.
const { form, vacancy, workspace } = en.applications
/** The page asks again every 5 s while the vacancy page is read. */
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

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

test.describe('the apply form', () => {
    test('lists the questions with their answers and copies them', async ({ page }) => {
        await page.goto('/applications/application-040?lang=en')
        const section = page.getByRole('region', {
            name: form.title,
        })
        await expect(section).toBeVisible()
        const question = (label: string) =>
            section.getByRole('listitem').filter({
                has: page.getByRole('heading', {
                    level: 3,
                    name: label,
                }),
            })

        await expect(question('First name')).toContainText(`${form.required} · ${form.type.text}`)
        await expect(question('Desired start date')).toContainText(form.fillIn)
        const authorized = question('Are you authorized to work in Germany?')
        await expect(
            authorized.getByRole('list', {
                name: form.options,
            }),
        ).toContainText('No')

        const resume = question('Resume/CV')
        await expect(resume).toContainText(form.attachCv)
        await resume
            .getByRole('button', {
                name: `Copy ${workspace.cvLink}`,
            })
            .click()
        expect(await clipboard(page)).toBe(CV_URL)

        await section
            .getByRole('button', {
                name: 'Copy Why do you want to join us?',
            })
            .click()
        await expect(page.getByText('Why do you want to join us? copied')).toBeVisible()
        expect(await clipboard(page)).toBe('I build TypeScript APIs and would like to work on your platform.')

        await section
            .getByRole('button', {
                name: form.copyAll,
            })
            .click()
        expect(await clipboard(page)).toBe(
            [
                'First name: Alex',
                'Why do you want to join us?: I build TypeScript APIs and would like to work on your platform.',
                'Are you authorized to work in Germany?: Yes',
            ].join('\n'),
        )
    })

    test('is hidden without a form', async ({ page }) => {
        await page.goto('/applications/application-010?lang=en')
        await expect(
            page.getByRole('heading', {
                level: 1,
            }),
        ).toBeVisible()
        await expect(
            page.getByRole('heading', {
                name: form.title,
            }),
        ).toHaveCount(0)
        await expect(page.getByText(vacancy.fetchFailed)).toHaveCount(0)
    })

    test('reads a page that failed again and shows its form', async ({ page }) => {
        await page.goto('/applications/application-012?lang=en')
        await expect(page.getByText(vacancy.fetchFailed)).toBeVisible()
        await expect(
            page.getByRole('heading', {
                name: form.title,
            }),
        ).toHaveCount(0)
        await page
            .getByRole('button', {
                name: vacancy.fetchAgain,
            })
            .click()
        await expect(page.getByText(vacancy.fetchStarted)).toBeVisible()
        await expect(
            page.getByRole('heading', {
                name: form.title,
            }),
        ).toBeVisible(POLLED)
        await expect(page.getByText(vacancy.fetchFailed)).toHaveCount(0)
        // No messages yet: the four questions but the file wait for their answers.
        await expect(page.getByText(form.noAnswer)).toHaveCount(4)
    })
})
