import { describe, expect, it, vi } from 'vitest'
import { BodyTooLargeError, byteLimit, declaredLength, discardBody, readBody } from './body-limit'

const bytes = (size: number, fill = 97) => new Uint8Array(size).fill(fill)

/** A stream of the given chunks; `hang` keeps it open after them, like a stalled client. */
function source(chunks: Uint8Array[], { hang = false } = {}) {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
            if (!hang) controller.close()
        },
        cancel,
    })
    return {
        stream,
        cancel,
    }
}

async function collect(stream: ReadableStream<Uint8Array>) {
    let total = 0
    for await (const chunk of stream) total += chunk.byteLength
    return total
}

describe('byteLimit', () => {
    it('passes a body of exactly the limit', async () => {
        const { stream } = source([
            bytes(6),
            bytes(4),
        ])
        await expect(collect(stream.pipeThrough(byteLimit(10)))).resolves.toBe(10)
    })

    it('errors on the first byte past the limit', async () => {
        const { stream } = source([
            bytes(6),
            bytes(5),
        ])
        await expect(collect(stream.pipeThrough(byteLimit(10)))).rejects.toBeInstanceOf(BodyTooLargeError)
    })

    it('passes an empty body', async () => {
        const { stream } = source([])
        await expect(collect(stream.pipeThrough(byteLimit(0)))).resolves.toBe(0)
    })
})

describe('readBody', () => {
    const forever = () => new AbortController().signal

    it('joins the chunks of a body within the limit', async () => {
        const { stream } = source([
            new TextEncoder().encode('{"title":'),
            new TextEncoder().encode('"a"}'),
        ])
        const body = await readBody(stream, {
            limit: 1024,
            signal: forever(),
        })
        expect(new TextDecoder().decode(body)).toBe('{"title":"a"}')
    })

    it('stops at the limit without a Content-Length and leaves the source open', async () => {
        const chunk = bytes(64 * 1024)
        const { stream, cancel } = source(
            Array.from(
                {
                    length: 32,
                },
                () => chunk,
            ),
            {
                hang: true,
            },
        )
        await expect(
            readBody(stream, {
                limit: 1024 * 1024,
                signal: forever(),
            }),
        ).rejects.toBeInstanceOf(BodyTooLargeError)
        // Not cancelled (that would reset the client's connection) and free for discardBody.
        expect(cancel).not.toHaveBeenCalled()
        expect(stream.locked).toBe(false)
    })

    it('gives up on a stalled body when the deadline passes', async () => {
        const { stream, cancel } = source(
            [
                bytes(10),
            ],
            {
                hang: true,
            },
        )
        const started = performance.now()
        await expect(
            readBody(stream, {
                limit: 1024,
                signal: AbortSignal.timeout(50),
            }),
        ).rejects.toMatchObject({
            name: 'TimeoutError',
        })
        expect(performance.now() - started).toBeLessThan(1000)
        expect(cancel).not.toHaveBeenCalled()
        expect(stream.locked).toBe(false)
    })

    it('passes on an error of the source', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('client went away'))
            },
        })
        await expect(
            readBody(stream, {
                limit: 1024,
                signal: forever(),
            }),
        ).rejects.toThrow('client went away')
    })
})

describe('discardBody', () => {
    it('reads the rest of a body and drops it', async () => {
        const pulled = vi.fn()
        let sent = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled()
                sent += 1
                if (sent > 3) controller.close()
                else controller.enqueue(bytes(100))
            },
        })
        discardBody(stream, 1000)
        await vi.waitFor(() => expect(pulled).toHaveBeenCalledTimes(4))
    })

    it('cancels a body that does not end in time', async () => {
        const { stream, cancel } = source([], {
            hang: true,
        })
        discardBody(stream, 20)
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    })
})

describe('declaredLength', () => {
    it.for([
        [
            '1048576',
            1048576,
        ],
        [
            ' 12 ',
            12,
        ],
        [
            '',
            undefined,
        ],
        [
            '-1',
            undefined,
        ],
        [
            '1e6',
            undefined,
        ],
    ] as const)('reads %j as %s', ([value, expected]) => {
        expect(
            declaredLength(
                new Headers({
                    'content-length': value,
                }),
            ),
        ).toBe(expected)
    })

    it('is undefined without the header', () => {
        expect(declaredLength(new Headers())).toBeUndefined()
    })
})
