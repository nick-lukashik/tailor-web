import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { applicationKeys } from '@/lib/api/applications'
import { createApiClient } from '@/lib/api/client'
import { type VacancyIntakeInput } from '@/lib/api/types'
import { INTAKE_MAX_ITEMS, vacancyMutations } from '@/lib/api/vacancies'
import {
    type IntakeDraft,
    type IntakeOutcome,
    type IntakeProblem,
    intakeInput,
    linksOf,
    outcomeOf,
    problemOf,
} from './vacancy-intake'

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    })

/** The form's submission path: draft → request → the intake mutation (fake fetch) → outcome or problem. */
async function submit(draft: IntakeDraft, answer: Response) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => answer)
    const api = createApiClient({
        baseUrl: '',
        fetch,
    })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const checked = intakeInput(draft)
    if (!('input' in checked)) throw new Error('expected a request')
    const observer = new MutationObserver(client, vacancyMutations.intake(api))
    const settled: {
        outcome?: IntakeOutcome
        problem?: IntakeProblem
    } = await observer.mutate(checked.input).then(
        result => ({
            outcome: outcomeOf(draft.mode, result),
        }),
        (error: unknown) => ({
            problem: problemOf(error),
        }),
    )
    const [url, init] = fetch.mock.calls[0] ?? []
    return {
        ...settled,
        url,
        method: init?.method,
        body: JSON.parse(String(init?.body)) as VacancyIntakeInput,
        invalidate,
    }
}

const intakeAnswer = (results: ('created' | 'existing')[]) =>
    json(200, {
        created: results.filter(result => result === 'created').length,
        existing: results.filter(result => result === 'existing').length,
        items: results.map((result, index) => ({
            applicationId: `00000000-0000-4000-8000-00000000000${index}`,
            vacancyId: `00000000-0000-4000-9000-00000000000${index}`,
            result,
        })),
    })

describe('single vacancy', () => {
    it('sends the link and the text as pasted, then says "added" and refreshes the lists', async () => {
        const text = '  Senior engineer\n\n\tRemote, full time  '
        const sent = await submit(
            {
                mode: 'single',
                url: ' https://jobs.example.com/1 ',
                text,
            },
            intakeAnswer([
                'created',
            ]),
        )
        expect(sent.url).toBe('/api/v1/vacancies/intake')
        expect(sent.method).toBe('POST')
        expect(sent.body).toEqual({
            items: [
                {
                    url: 'https://jobs.example.com/1',
                    text,
                },
            ],
        })
        expect(sent.outcome).toEqual({
            kind: 'added',
        })
        expect(sent.invalidate).toHaveBeenCalledWith({
            queryKey: applicationKeys.lists(),
        })
    })

    it('sends only what is filled and says "already in your list" for a known one', async () => {
        const sent = await submit(
            {
                mode: 'single',
                url: '',
                text: 'Backend engineer at Example',
            },
            intakeAnswer([
                'existing',
            ]),
        )
        expect(sent.body).toEqual({
            items: [
                {
                    text: 'Backend engineer at Example',
                },
            ],
        })
        expect(sent.outcome).toEqual({
            kind: 'existing',
        })
    })

    it('refuses an empty form without sending', () => {
        expect(
            intakeInput({
                mode: 'single',
                url: '  ',
                text: '\n\t ',
            }),
        ).toEqual({
            problem: {
                kind: 'empty',
            },
        })
    })

    it("shows the API's validation message from a 400", async () => {
        const sent = await submit(
            {
                mode: 'single',
                url: 'https://',
                text: '',
            },
            json(400, {
                code: 'VALIDATION_FAILED',
                message: 'Request validation failed',
                details: [
                    {
                        path: 'items.0.url',
                        message: 'Invalid URL',
                    },
                ],
                requestId: 'r1',
            }),
        )
        expect(sent.problem).toEqual({
            kind: 'rejected',
            issues: [
                {
                    item: 0,
                    message: 'Invalid URL',
                },
            ],
        })
        expect(sent.invalidate).not.toHaveBeenCalled()
    })
})

describe('several links', () => {
    it('sends every non-empty line as one request and counts the results', async () => {
        const sent = await submit(
            {
                mode: 'batch',
                links: 'https://jobs.example.com/1\r\n\n  https://jobs.example.com/2  \n \nhttps://jobs.example.com/3\n',
            },
            intakeAnswer([
                'created',
                'existing',
                'created',
            ]),
        )
        expect(sent.body).toEqual({
            items: [
                {
                    url: 'https://jobs.example.com/1',
                },
                {
                    url: 'https://jobs.example.com/2',
                },
                {
                    url: 'https://jobs.example.com/3',
                },
            ],
        })
        expect(sent.outcome).toEqual({
            kind: 'batch',
            created: 2,
            existing: 1,
        })
        expect(sent.invalidate).toHaveBeenCalledWith({
            queryKey: applicationKeys.lists(),
        })
    })

    it('refuses no links without sending', () => {
        expect(
            intakeInput({
                mode: 'batch',
                links: '\n  \n',
            }),
        ).toEqual({
            problem: {
                kind: 'empty',
            },
        })
    })

    it(`takes ${INTAKE_MAX_ITEMS} links and refuses more`, () => {
        const lines = (count: number) =>
            Array.from(
                {
                    length: count,
                },
                (_, index) => `https://jobs.example.com/${index}`,
            ).join('\n')
        const max = intakeInput({
            mode: 'batch',
            links: `${lines(INTAKE_MAX_ITEMS)}\n\n`,
        })
        expect('input' in max && max.input.items).toHaveLength(INTAKE_MAX_ITEMS)
        expect(
            intakeInput({
                mode: 'batch',
                links: lines(INTAKE_MAX_ITEMS + 1),
            }),
        ).toEqual({
            problem: {
                kind: 'tooMany',
                count: INTAKE_MAX_ITEMS + 1,
            },
        })
    })

    it('ties each refused link to its number', async () => {
        const sent = await submit(
            {
                mode: 'batch',
                links: 'https://jobs.example.com/1\nhttp://',
            },
            json(400, {
                code: 'VALIDATION_FAILED',
                message: 'Request validation failed',
                details: [
                    {
                        path: 'items.1.url',
                        message: 'Invalid URL',
                    },
                    {
                        path: 'items',
                        message: 'Too big',
                    },
                ],
                requestId: 'r2',
            }),
        )
        expect(sent.problem).toEqual({
            kind: 'rejected',
            issues: [
                {
                    item: 1,
                    message: 'Invalid URL',
                },
                {
                    item: null,
                    message: 'Too big',
                },
            ],
        })
    })
})

describe('problemOf', () => {
    it('uses the message of a 400 without details', async () => {
        const sent = await submit(
            {
                mode: 'single',
                url: 'https://jobs.example.com/1',
                text: '',
            },
            json(400, {
                code: 'VALIDATION_FAILED',
                message: 'Body is not JSON',
                requestId: 'r3',
            }),
        )
        expect(sent.problem).toEqual({
            kind: 'rejected',
            issues: [
                {
                    item: null,
                    message: 'Body is not JSON',
                },
            ],
        })
    })

    it.each([
        [
            413,
            'tooLarge',
        ],
        [
            500,
            'failed',
        ],
        [
            503,
            'failed',
        ],
    ] as const)('maps HTTP %i to %s', async (status, kind) => {
        const sent = await submit(
            {
                mode: 'single',
                url: 'https://jobs.example.com/1',
                text: '',
            },
            new Response('nope', {
                status,
            }),
        )
        expect(sent.problem).toEqual({
            kind,
        })
    })

    it('treats anything else as a failure', () => {
        expect(problemOf(new TypeError('boom'))).toEqual({
            kind: 'failed',
        })
    })
})

describe('linksOf', () => {
    it('keeps non-empty trimmed lines', () => {
        expect(linksOf(' a \r\n\n b\n   ')).toEqual([
            'a',
            'b',
        ])
    })
})
