import { describe, expect, it, test } from 'vitest'
import { type ApplyChannel, type VacancySalary } from '@/lib/api/types'
import { applyChannelLink, type FormatNumber, httpUrl, languageCode, parseProblem, salaryText } from './vacancy-format'

const formatIn =
    (locale: string): FormatNumber =>
    (value, options) =>
        new Intl.NumberFormat(locale, options).format(value)
const en = formatIn('en')

const salary = (changes: Partial<VacancySalary>): VacancySalary => ({
    min: null,
    max: null,
    currency: null,
    period: null,
    ...changes,
})

describe('salaryText', () => {
    it('formats a range in the currency, with its period', () => {
        expect(
            salaryText(
                salary({
                    min: 60_000,
                    max: 80_000,
                    currency: 'EUR',
                    period: 'year',
                }),
                en,
            ),
        ).toEqual({
            bound: 'range',
            amount: '€60,000–€80,000',
            period: 'year',
        })
    })

    it('puts a reversed range in order and reads a lower-case code', () => {
        expect(
            salaryText(
                salary({
                    min: 300_000,
                    max: 200_000,
                    currency: 'rub',
                }),
                formatIn('ru'),
            )?.amount,
        ).toMatch(/^200\s000\s₽–300\s000\s₽$/)
    })

    test.for([
        {
            changes: {
                min: 5_000,
                max: 5_000,
                currency: 'USD',
            },
            expected: {
                bound: 'exact',
                amount: '$5,000',
            },
        },
        {
            changes: {
                min: 45.5,
                currency: 'GBP',
                period: 'hour',
            },
            expected: {
                bound: 'from',
                amount: '£45.5',
                period: 'hour',
            },
        },
        {
            changes: {
                max: 4_000,
                currency: 'USDT',
            },
            expected: {
                bound: 'upTo',
                amount: '4,000 USDT',
            },
        },
        {
            changes: {
                min: 100,
            },
            expected: {
                bound: 'from',
                amount: '100',
            },
        },
    ] as {
        changes: Partial<VacancySalary>
        expected: object
    }[])('$expected.bound $expected.amount', ({ changes, expected }) => {
        expect(salaryText(salary(changes), en)).toMatchObject(expected)
    })

    it('is null without an amount', () => {
        expect(salaryText(null, en)).toBeNull()
        expect(
            salaryText(
                salary({
                    currency: 'EUR',
                    period: 'month',
                }),
                en,
            ),
        ).toBeNull()
    })
})

describe('applyChannelLink', () => {
    const link = (kind: ApplyChannel['kind'], value: string) =>
        applyChannelLink({
            kind,
            value,
        })

    test.for([
        [
            'email',
            'jobs@example.com',
            'mailto:jobs@example.com',
        ],
        [
            'email',
            ' mailto:jobs@example.com ',
            'mailto:jobs@example.com',
        ],
        [
            'email',
            'write to HR',
            null,
        ],
        [
            'telegram',
            '@example_jobs',
            'https://t.me/example_jobs',
        ],
        [
            'telegram',
            'https://t.me/example_jobs',
            'https://t.me/example_jobs',
        ],
        [
            'telegram',
            'example_jobs',
            null,
        ],
        [
            'telegram',
            'https://example.com/@jobs',
            null,
        ],
        [
            'link',
            'https://jobs.example.com/apply',
            'https://jobs.example.com/apply',
        ],
        [
            'form',
            'jobs.example.com/apply',
            'https://jobs.example.com/apply',
        ],
        [
            'link',
            'javascript:alert(1)',
            null,
        ],
        [
            'other',
            'jobs@example.com',
            'mailto:jobs@example.com',
        ],
        [
            'other',
            'Ask the recruiter',
            null,
        ],
    ] as [
        ApplyChannel['kind'],
        string,
        string | null,
    ][])('%s %j → %j', ([kind, value, href]) => {
        expect(link(kind, value).href).toBe(href)
    })

    it('labels an email without its mailto: and keeps the rest as written', () => {
        expect(link('email', 'mailto:jobs@example.com').label).toBe('jobs@example.com')
        expect(link('telegram', '@example_jobs').label).toBe('@example_jobs')
        expect(link('other', ' Ask the recruiter ').label).toBe('Ask the recruiter')
    })
})

describe('httpUrl', () => {
    test.for([
        [
            'https://example.com/jobs/1',
            'https://example.com/jobs/1',
        ],
        [
            'ftp://example.com',
            null,
        ],
        [
            'not a url',
            null,
        ],
        [
            null,
            null,
        ],
    ] as [
        string | null,
        string | null,
    ][])('%j → %j', ([value, url]) => {
        expect(httpUrl(value)).toBe(url)
    })
})

describe('languageCode', () => {
    test.for([
        [
            'EN',
            'en',
        ],
        [
            'pt-BR',
            'pt-br',
        ],
        [
            ' ',
            null,
        ],
        [
            'English language',
            null,
        ],
        [
            null,
            null,
        ],
    ] as [
        string | null,
        string | null,
    ][])('%j → %j', ([code, expected]) => {
        expect(languageCode(code)).toBe(expected)
    })
})

describe('parseProblem', () => {
    it('tells a missing text from any other failure', () => {
        expect(
            parseProblem({
                parseError: 'no_text',
            }),
        ).toBe('noText')
        expect(
            parseProblem({
                parseError: 'model_error',
            }),
        ).toBe('failed')
        expect(
            parseProblem({
                parseError: null,
            }),
        ).toBe('failed')
    })
})
