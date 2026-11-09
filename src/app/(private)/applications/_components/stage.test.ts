import { describe, expect, it, test } from 'vitest'
import { type Application } from '@/lib/api/types'
import {
    applicationStage,
    filterApplications,
    matchesSearch,
    type Stage,
    type StageFields,
    stageCounts,
    stageFilterOf,
} from './stage'

const fields = (changes: Partial<StageFields>): StageFields => ({
    status: 'new',
    parseStatus: 'parsed',
    cvStatus: 'ready',
    materialsStatus: 'ready',
    ...changes,
})

const row = (id: string, changes: Partial<Application>): Application => ({
    id,
    company: '',
    role: '',
    vacancyUrl: null,
    vacancyText: '',
    status: 'new',
    vacancyId: null,
    parseStatus: 'parsed',
    cvStatus: 'ready',
    materialsStatus: 'ready',
    createdAt: '2026-11-09T10:00:00.000Z',
    ...changes,
})

describe('applicationStage', () => {
    test.for([
        [
            {},
            'ready',
        ],
        [
            {
                parseStatus: 'pending',
                cvStatus: 'none',
                materialsStatus: 'none',
            },
            'reading',
        ],
        [
            {
                cvStatus: 'queued',
                materialsStatus: 'none',
            },
            'generating',
        ],
        [
            {
                cvStatus: 'generating',
            },
            'generating',
        ],
        [
            {
                materialsStatus: 'queued',
            },
            'generating',
        ],
        [
            {
                materialsStatus: 'generating',
            },
            'generating',
        ],
        [
            {
                parseStatus: 'failed',
                cvStatus: 'none',
                materialsStatus: 'none',
            },
            'failed',
        ],
        [
            {
                cvStatus: 'failed',
            },
            'failed',
        ],
        [
            {
                materialsStatus: 'failed',
            },
            'failed',
        ],
        // A newer CV is being made after a failure: something runs, so it is generating.
        [
            {
                cvStatus: 'generating',
                materialsStatus: 'failed',
            },
            'generating',
        ],
        [
            {
                materialsStatus: 'none',
            },
            'incomplete',
        ],
        [
            {
                parseStatus: null,
                cvStatus: 'none',
                materialsStatus: 'none',
            },
            'incomplete',
        ],
        [
            {
                status: 'sent',
                materialsStatus: 'generating',
            },
            'sent',
        ],
        [
            {
                status: 'interview',
            },
            'interview',
        ],
        [
            {
                status: 'offer',
                cvStatus: 'failed',
            },
            'offer',
        ],
        [
            {
                status: 'rejected',
                parseStatus: 'pending',
            },
            'rejected',
        ],
    ] as [
        Partial<StageFields>,
        Stage,
    ][])('%j → %s', ([changes, stage]) => {
        expect(applicationStage(fields(changes))).toBe(stage)
    })
})

describe('stageCounts', () => {
    it('counts every row under All and each under its stage, an incomplete one under All only', () => {
        expect(
            stageCounts([
                fields({}),
                fields({}),
                fields({
                    parseStatus: 'pending',
                }),
                fields({
                    cvStatus: 'generating',
                }),
                fields({
                    status: 'sent',
                }),
                fields({
                    status: 'rejected',
                }),
                fields({
                    cvStatus: 'failed',
                }),
                fields({
                    materialsStatus: 'none',
                }),
            ]),
        ).toEqual({
            all: 8,
            reading: 1,
            generating: 1,
            ready: 2,
            sent: 1,
            interview: 0,
            offer: 0,
            rejected: 1,
            failed: 1,
        })
    })

    it('is all zeros for no rows', () => {
        expect(Object.values(stageCounts([]))).toEqual(Array(9).fill(0))
    })
})

describe('stageFilterOf', () => {
    test.for([
        [
            'sent',
            'sent',
        ],
        [
            'ready',
            'ready',
        ],
        [
            'incomplete',
            'all',
        ],
        [
            'SENT',
            'all',
        ],
        [
            '',
            'all',
        ],
        [
            null,
            'all',
        ],
    ] as [
        string | null,
        string,
    ][])('%j → %s', ([value, filter]) => {
        expect(stageFilterOf(value)).toBe(filter)
    })
})

describe('matchesSearch', () => {
    const application = {
        company: 'Café Example GmbH',
        role: 'Senior Backend Engineer',
        vacancyUrl: 'https://jobs.example.com/1',
    }

    test.for([
        [
            '',
            true,
        ],
        [
            '   ',
            true,
        ],
        [
            'cafe',
            true,
        ],
        [
            'BACKEND',
            true,
        ],
        [
            'example  engineer',
            true,
        ],
        [
            'frontend',
            false,
        ],
        [
            'example frontend',
            false,
        ],
    ] as [
        string,
        boolean,
    ][])('%j → %s', ([query, found]) => {
        expect(matchesSearch(application, query)).toBe(found)
    })

    it('finds a pasted vacancy by its link host until it is read', () => {
        expect(
            matchesSearch(
                {
                    company: '',
                    role: '',
                    vacancyUrl: 'https://www.jobs.example.com/1',
                },
                'jobs.example',
            ),
        ).toBe(true)
    })
})

describe('filterApplications', () => {
    const items = [
        row('a', {
            company: 'Alpha',
        }),
        row('b', {
            company: 'Beta',
            status: 'sent',
        }),
        row('c', {
            company: 'Alpha Two',
            status: 'sent',
        }),
        row('d', {
            company: 'Delta',
            parseStatus: 'pending',
        }),
    ]

    it('keeps the order and applies the chip and the query together', () => {
        expect(filterApplications(items, 'all', '').map(item => item.id)).toEqual([
            'a',
            'b',
            'c',
            'd',
        ])
        expect(filterApplications(items, 'sent', '').map(item => item.id)).toEqual([
            'b',
            'c',
        ])
        expect(filterApplications(items, 'sent', 'alpha').map(item => item.id)).toEqual([
            'c',
        ])
        expect(filterApplications(items, 'reading', 'alpha')).toEqual([])
    })
})
