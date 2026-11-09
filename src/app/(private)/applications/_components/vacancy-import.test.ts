import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { type VacancyIntakeItem } from '@/lib/api/types'
import { MAX_BODY_BYTES } from '@/lib/http/body-limit'
import { CHUNK_MAX_BYTES, chunkErrorMessage, chunkItems, importItems, sendChunks, TEXT_MAX } from './vacancy-import'

const links = (count: number): VacancyIntakeItem[] =>
    Array.from(
        {
            length: count,
        },
        (_, index) => ({
            url: `https://jobs.example.com/${index}`,
        }),
    )

const bodyBytes = (items: VacancyIntakeItem[]) =>
    new TextEncoder().encode(
        JSON.stringify({
            items,
        }),
    ).byteLength

describe('chunkItems', () => {
    it('splits by 200 items, in file order', () => {
        const chunks = chunkItems(links(450))
        expect(chunks.map(chunk => chunk.items.length)).toEqual([
            200,
            200,
            50,
        ])
        expect(chunks.map(chunk => chunk.from)).toEqual([
            0,
            200,
            400,
        ])
        expect(chunks.flatMap(chunk => chunk.items)).toEqual(links(450))
    })

    it('is one request for a small file and none for no items', () => {
        expect(chunkItems(links(3))).toEqual([
            {
                from: 0,
                items: links(3),
            },
        ])
        expect(chunkItems([])).toEqual([])
    })

    it('splits further so that no body goes over the cap', () => {
        // 30 texts of ~90 kB: 200 of them would be ~2.7 MB.
        const items = Array.from(
            {
                length: 30,
            },
            (_, index) => ({
                url: `https://jobs.example.com/${index}`,
                text: `${index} ${'x'.repeat(90_000)}`,
            }),
        )
        const chunks = chunkItems(items)
        expect(chunks.length).toBeGreaterThan(2)
        for (const chunk of chunks) expect(bodyBytes(chunk.items)).toBeLessThanOrEqual(CHUNK_MAX_BYTES)
        expect(CHUNK_MAX_BYTES).toBeLessThan(MAX_BODY_BYTES)
        expect(chunks.flatMap(chunk => chunk.items)).toEqual(items)
    })

    it('counts bytes, not characters', () => {
        // Cyrillic is two bytes a character in UTF-8.
        const items = Array.from(
            {
                length: 4,
            },
            () => ({
                text: 'я'.repeat(1_000),
            }),
        )
        const two = bodyBytes(items.slice(0, 2))
        // 2 000 bytes a text: by characters two would fit in far less.
        expect(two).toBeGreaterThan(4_000)
        expect(
            chunkItems(items, {
                maxBytes: two - 1,
            }).map(chunk => chunk.items.length),
        ).toEqual([
            1,
            1,
            1,
            1,
        ])
        expect(
            chunkItems(items, {
                maxBytes: two,
            }).map(chunk => chunk.items.length),
        ).toEqual([
            2,
            2,
        ])
    })

    it('gives an item too large on its own a request of its own', () => {
        const big = {
            text: 'x'.repeat(500),
        }
        const chunks = chunkItems(
            [
                ...links(2),
                big,
                ...links(1),
            ],
            {
                maxBytes: 200,
            },
        )
        expect(chunks.map(chunk => chunk.items)).toEqual([
            links(2),
            [
                big,
            ],
            links(1),
        ])
        expect(chunks.map(chunk => chunk.from)).toEqual([
            0,
            2,
            3,
        ])
    })

    it('honours a smaller item limit', () => {
        expect(
            chunkItems(links(5), {
                maxItems: 2,
            }).map(chunk => chunk.items.length),
        ).toEqual([
            2,
            2,
            1,
        ])
    })
})

describe('importItems', () => {
    it('takes the intake body, trimming links and dropping blank texts', () => {
        expect(
            importItems(
                JSON.stringify({
                    items: [
                        {
                            url: ' https://jobs.example.com/1 ',
                        },
                        {
                            text: 'Engineer wanted.',
                        },
                        {
                            url: 'https://jobs.example.com/2',
                            text: '  ',
                        },
                    ],
                }),
            ),
        ).toEqual({
            items: [
                {
                    url: 'https://jobs.example.com/1',
                },
                {
                    text: 'Engineer wanted.',
                },
                {
                    url: 'https://jobs.example.com/2',
                },
            ],
        })
    })

    it.each([
        [
            'not json',
            'notJson',
        ],
        [
            '[]',
            'shape',
        ],
        [
            '{"links": []}',
            'shape',
        ],
        [
            'null',
            'shape',
        ],
        [
            '{"items": []}',
            'empty',
        ],
    ])('refuses %j (%s)', (source, kind) => {
        expect(importItems(source)).toEqual({
            problem: {
                kind,
            },
        })
    })

    it('names every bad item and sends nothing', () => {
        expect(
            importItems(
                JSON.stringify({
                    items: [
                        {
                            url: 'https://jobs.example.com/1',
                        },
                        'https://jobs.example.com/2',
                        {
                            url: 'ftp://example.com',
                        },
                        {
                            text: 'x'.repeat(TEXT_MAX + 1),
                        },
                        {
                            text: ' ',
                        },
                        {
                            url: 'https://jobs.example.com/3',
                            company: 'Example',
                        },
                    ],
                }),
            ),
        ).toEqual({
            problem: {
                kind: 'items',
                issues: [
                    {
                        item: 1,
                        reason: 'notObject',
                    },
                    {
                        item: 2,
                        reason: 'url',
                    },
                    {
                        item: 3,
                        reason: 'text',
                    },
                    {
                        item: 4,
                        reason: 'empty',
                    },
                    {
                        item: 5,
                        reason: 'unknownKey',
                    },
                ],
            },
        })
    })
})

describe('sendChunks', () => {
    it('sends one after another, adds up the results and goes on after a failure', async () => {
        const chunks = chunkItems(links(5), {
            maxItems: 2,
        })
        const refused = new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
            {
                path: 'items.0.url',
                message: 'Invalid URL',
            },
        ])
        const calls: number[] = []
        const send = vi.fn(async (items: VacancyIntakeItem[]) => {
            calls.push(items.length)
            if (calls.length === 2) throw refused
            return {
                created: items.length - 1,
                existing: 1,
                items: [],
            }
        })
        const progress = vi.fn()
        await expect(sendChunks(chunks, send, progress)).resolves.toEqual({
            created: 1,
            existing: 2,
            failures: [
                {
                    from: 2,
                    count: 2,
                    error: refused,
                },
            ],
        })
        expect(calls).toEqual([
            2,
            2,
            1,
        ])
        expect(progress.mock.calls).toEqual([
            [
                1,
                3,
            ],
            [
                2,
                3,
            ],
            [
                3,
                3,
            ],
        ])
    })
})

describe('chunkErrorMessage', () => {
    it('gives the first validation issue, nothing for other failures', () => {
        expect(
            chunkErrorMessage(
                new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', [
                    {
                        path: 'items.3.url',
                        message: 'Invalid URL',
                    },
                ]),
            ),
        ).toBe('items.3.url: Invalid URL')
        expect(chunkErrorMessage(new ApiError(400, 'VALIDATION_FAILED', 'Body is not JSON'))).toBe('Body is not JSON')
        expect(chunkErrorMessage(new ApiError(503, 'UNAVAILABLE', 'HTTP 503'))).toBeNull()
        expect(chunkErrorMessage(new TypeError('boom'))).toBeNull()
    })
})
