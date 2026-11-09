import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

const WCAG = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
]
const pages = [
    '/applications',
    '/applications/application-010',
    '/applications/application-012',
    '/applications/application-040',
    '/profile',
    '/nowhere',
]

test.describe('accessibility', () => {
    for (const path of pages) {
        test(`${path} has no axe violations`, async ({ page }) => {
            await page.goto(path)
            await page.locator('main').waitFor()
            const results = await new AxeBuilder({
                page,
            })
                .withTags(WCAG)
                .analyze()
            expect(results.violations).toEqual([])
        })
    }
})
