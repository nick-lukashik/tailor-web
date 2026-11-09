import { describe, expect, it, test } from 'vitest'
import { type ApplyChannel, type MaterialsContent } from '@/lib/api/types'
import { applyEmail, firstTab, mailtoOf, materialsProblem, materialsView, whyMeText } from './materials-view'

const content: MaterialsContent = {
    language: 'en',
    coverLetter: 'Dear team,\n\nI would like to apply.',
    emailSubject: 'Backend engineer: Alex Example',
    emailBody: 'Hello,\n\nMy CV: https://cv.example.com/a/CV.pdf',
    telegramMessage: 'Hi! CV: https://cv.example.com/a/CV.pdf',
    linkedinNote: 'Hi, glad to connect.',
    whyMe: [
        'Five years of TypeScript',
    ],
}
const CV = {
    url: 'https://cv.example.com/a/CV.pdf',
}
const NO_CV = {}

describe('materialsView', () => {
    it('waits for a vacancy, then for a ready CV, then offers to write them', () => {
        const none = {
            status: 'none',
        } as const
        expect(materialsView(none, CV, false)).toEqual({
            kind: 'noVacancy',
        })
        expect(materialsView(none, NO_CV, true)).toEqual({
            kind: 'waitingCv',
        })
        expect(materialsView(none, CV, true)).toEqual({
            kind: 'none',
        })
    })

    it.each([
        'queued',
        'generating',
    ] as const)('is generating while %s, keeping the older texts', status => {
        expect(
            materialsView(
                {
                    status,
                    version: 2,
                },
                CV,
                true,
            ),
        ).toEqual({
            kind: 'generating',
            content: null,
        })
        expect(
            materialsView(
                {
                    status,
                    version: 2,
                    content,
                },
                CV,
                true,
            ),
        ).toEqual({
            kind: 'generating',
            content,
        })
    })

    it('gives the texts and the version of a ready one', () => {
        expect(
            materialsView(
                {
                    status: 'ready',
                    version: 3,
                    content,
                },
                CV,
                true,
            ),
        ).toEqual({
            kind: 'ready',
            content,
            version: 3,
        })
    })

    it('treats a ready one without texts as failed', () => {
        expect(
            materialsView(
                {
                    status: 'ready',
                },
                CV,
                true,
            ),
        ).toEqual({
            kind: 'failed',
            content: null,
            problem: 'failed',
        })
    })

    it('explains a failure and keeps the older texts', () => {
        expect(
            materialsView(
                {
                    status: 'failed',
                    version: 2,
                    content,
                    error: 'llm_timeout',
                },
                CV,
                true,
            ),
        ).toEqual({
            kind: 'failed',
            content,
            problem: 'model',
        })
    })
})

describe('materialsProblem', () => {
    test.for([
        [
            'no_profile',
            'noProfile',
        ],
        [
            'llm_bad_request',
            'model',
        ],
        [
            'internal',
            'failed',
        ],
        [
            undefined,
            'failed',
        ],
    ] as [
        string | undefined,
        string,
    ][])('%j → %s', ([error, problem]) => {
        expect(materialsProblem(error)).toBe(problem)
    })
})

const channel = (kind: ApplyChannel['kind'], value: string): ApplyChannel => ({
    kind,
    value,
})

describe('firstTab', () => {
    test.for([
        [
            [
                channel('email', 'jobs@example.com'),
                channel('telegram', '@example_jobs'),
            ],
            'email',
        ],
        [
            [
                channel('email', 'write to HR'),
                channel('telegram', '@example_jobs'),
            ],
            'telegram',
        ],
        [
            [
                channel('form', 'https://jobs.example.com/apply'),
            ],
            'coverLetter',
        ],
        [
            [],
            'email',
        ],
    ] as [
        ApplyChannel[],
        string,
    ][])('%j → %s', ([channels, tab]) => {
        expect(firstTab(channels)).toBe(tab)
    })
})

describe('applyEmail', () => {
    it('takes the first address the vacancy names', () => {
        expect(
            applyEmail([
                channel('telegram', '@example_jobs'),
                channel('other', 'hr@example.com'),
                channel('email', 'jobs@example.com'),
            ]),
        ).toBe('hr@example.com')
        expect(
            applyEmail([
                channel('form', 'https://jobs.example.com/apply'),
            ]),
        ).toBeNull()
    })
})

describe('mailtoOf', () => {
    it('fills the subject and the body, spaces as %20', () => {
        expect(mailtoOf('jobs@example.com', 'Engineer: A+B', 'Hi,\n\nCV & more')).toBe(
            'mailto:jobs@example.com?subject=Engineer%3A%20A%2BB&body=Hi%2C%0A%0ACV%20%26%20more',
        )
    })
})

describe('whyMeText', () => {
    it('makes one line per point, blank ones dropped', () => {
        expect(
            whyMeText([
                ' Five years of TypeScript ',
                '',
                'Runs PostgreSQL',
            ]),
        ).toBe('- Five years of TypeScript\n- Runs PostgreSQL')
    })
})
