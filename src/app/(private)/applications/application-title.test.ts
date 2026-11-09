import { describe, expect, it } from 'vitest'
import { applicationTitle, vacancyHost } from './application-title'

describe('vacancyHost', () => {
    it.each([
        [
            'https://www.example.com/jobs/1',
            'example.com',
        ],
        [
            'https://jobs.example.com/a?b=c',
            'jobs.example.com',
        ],
        [
            'not a url',
            null,
        ],
        [
            null,
            null,
        ],
    ])('%j → %j', (url, host) => {
        expect(vacancyHost(url)).toBe(host)
    })
})

describe('applicationTitle', () => {
    it('is the company when there is one', () => {
        expect(
            applicationTitle({
                company: 'Example Ltd',
                vacancyUrl: 'https://jobs.example.com/1',
            }),
        ).toBe('Example Ltd')
    })

    it('falls back to the link host for an unparsed vacancy', () => {
        expect(
            applicationTitle({
                company: '  ',
                vacancyUrl: 'https://jobs.example.com/1',
            }),
        ).toBe('jobs.example.com')
    })

    it('is null without a company and a link', () => {
        expect(
            applicationTitle({
                company: '',
                vacancyUrl: null,
            }),
        ).toBeNull()
    })
})
