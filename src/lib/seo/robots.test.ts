import { describe, expect, it } from 'vitest'
import { languageAlternates, localizedPath } from './alternates'
import { buildRobots } from './robots'

describe('buildRobots', () => {
    it('disallows everything and names no sitemap', () => {
        expect(buildRobots()).toEqual({
            rules: {
                userAgent: '*',
                disallow: '/',
            },
        })
    })
})

describe('languageAlternates', () => {
    it('lists every language and the negotiating x-default', () => {
        expect(languageAlternates('/about')).toEqual({
            en: '/about?lang=en',
            ru: '/about?lang=ru',
            'x-default': '/about',
        })
        expect(localizedPath('/', 'ru')).toBe('/?lang=ru')
    })
})
