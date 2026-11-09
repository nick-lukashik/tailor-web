import { describe, expect, it } from 'vitest'
import { applicationRole, applicationTitle, vacancyHost } from './application-title'

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

describe('with the vacancy read', () => {
    const vacancy = {
        url: 'https://jobs.example.com/2',
        parsed: {
            company: 'Example GmbH',
            title: 'Backend engineer',
        },
    }

    it('takes the company and the role from the vacancy when the application has none', () => {
        const application = {
            company: '',
            role: ' ',
            vacancyUrl: null,
            vacancy,
        }
        expect(applicationTitle(application)).toBe('Example GmbH')
        expect(applicationRole(application)).toBe('Backend engineer')
    })

    it("keeps the application's own company and role", () => {
        const application = {
            company: 'Own Ltd',
            role: 'Engineer',
            vacancyUrl: null,
            vacancy,
        }
        expect(applicationTitle(application)).toBe('Own Ltd')
        expect(applicationRole(application)).toBe('Engineer')
    })

    it("falls back to the vacancy link's host, and no role", () => {
        const application = {
            company: '',
            role: '',
            vacancyUrl: null,
            vacancy: {
                url: 'https://jobs.example.com/2',
                parsed: null,
            },
        }
        expect(applicationTitle(application)).toBe('jobs.example.com')
        expect(applicationRole(application)).toBeNull()
    })
})
