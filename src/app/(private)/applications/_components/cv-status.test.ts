import { describe, expect, it } from 'vitest'
import { type ApplicationCv } from '@/lib/api/types'
import { cvBadge, cvProblem, cvView } from './cv-status'

const URL = 'https://cv.example.com/application-1/Alex-Engineer-CV.pdf'
const parsed = {
    parseStatus: 'parsed',
} as const

describe('cvView', () => {
    it('says a CV needs a vacancy when there is none', () => {
        expect(
            cvView(
                {
                    status: 'none',
                },
                null,
            ),
        ).toEqual({
            kind: 'noVacancy',
        })
    })

    it.each([
        'pending',
        'failed',
    ] as const)('waits for the vacancy while it is %s', parseStatus => {
        expect(
            cvView(
                {
                    status: 'none',
                },
                {
                    parseStatus,
                },
            ),
        ).toEqual({
            kind: 'waiting',
        })
    })

    it('offers to generate a CV once the vacancy is read', () => {
        expect(
            cvView(
                {
                    status: 'none',
                },
                parsed,
            ),
        ).toEqual({
            kind: 'canGenerate',
        })
    })

    it.each([
        'queued',
        'generating',
    ] as const)('shows %s as generating, keeping the older ready link', status => {
        expect(
            cvView(
                {
                    status,
                    version: 2,
                },
                parsed,
            ),
        ).toEqual({
            kind: 'generating',
            url: null,
        })
        expect(
            cvView(
                {
                    status,
                    version: 2,
                    url: URL,
                },
                parsed,
            ),
        ).toEqual({
            kind: 'generating',
            url: URL,
        })
    })

    it('gives the link and the details of a ready CV', () => {
        expect(
            cvView(
                {
                    status: 'ready',
                    version: 3,
                    url: URL,
                    pages: 2,
                    model: 'model-a',
                    updatedAt: '2026-11-09T10:00:00.000Z',
                },
                parsed,
            ),
        ).toEqual({
            kind: 'ready',
            url: URL,
            version: 3,
            pages: 2,
            model: 'model-a',
        })
    })

    it('drops a link that is not http(s) and the details that are missing', () => {
        expect(
            cvView(
                {
                    status: 'ready',
                    url: 'javascript:alert(1)',
                    model: ' ',
                },
                parsed,
            ),
        ).toEqual({
            kind: 'ready',
            url: null,
            version: null,
            pages: null,
            model: null,
        })
    })

    it('explains a failed version and keeps the older ready link', () => {
        const cv: ApplicationCv = {
            status: 'failed',
            version: 2,
            url: URL,
            error: 'llm_timeout',
        }
        expect(cvView(cv, parsed)).toEqual({
            kind: 'failed',
            url: URL,
            problem: 'model',
        })
    })
})

describe('cvProblem', () => {
    it.each([
        [
            'storage_not_configured',
            'notConfigured',
        ],
        [
            'tex_not_configured',
            'notConfigured',
        ],
        [
            'llm_bad_request',
            'model',
        ],
        [
            'llm_timeout',
            'model',
        ],
        [
            'no_profile',
            'noProfile',
        ],
        [
            'cv_does_not_fit',
            'doesNotFit',
        ],
        [
            'cv_overfull',
            'doesNotFit',
        ],
        [
            'tex_unavailable',
            'failed',
        ],
        [
            'internal',
            'failed',
        ],
        [
            '',
            'failed',
        ],
        [
            undefined,
            'failed',
        ],
    ] as const)('%j → %s', (error, problem) => {
        expect(cvProblem(error)).toBe(problem)
    })
})

describe('cvBadge', () => {
    it.each([
        [
            'none',
            null,
        ],
        [
            'queued',
            'generating',
        ],
        [
            'generating',
            'generating',
        ],
        [
            'ready',
            'ready',
        ],
        [
            'failed',
            'failed',
        ],
    ] as const)('%s → %j', (status, badge) => {
        expect(cvBadge(status)).toBe(badge)
    })
})
