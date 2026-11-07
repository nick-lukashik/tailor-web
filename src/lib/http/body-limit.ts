/** Largest request body the /api proxy accepts (service contract: 1 MiB). */
export const MAX_BODY_BYTES = 1024 * 1024

export class BodyTooLargeError extends Error {
    override readonly name = 'BodyTooLargeError'

    constructor(readonly limit: number) {
        super(`Request body is larger than ${limit} bytes`)
    }
}

/**
 * Passes chunks through and errors as soon as more than `limit` bytes have
 * gone by. Counts what actually arrives, so it also covers chunked bodies
 * without Content-Length.
 */
export function byteLimit(limit: number): TransformStream<Uint8Array, Uint8Array> {
    let total = 0
    return new TransformStream({
        transform(chunk, controller) {
            total += chunk.byteLength
            if (total > limit) controller.error(new BodyTooLargeError(limit))
            else controller.enqueue(chunk)
        },
    })
}

/** Content-Length as a number; undefined when absent or not a plain integer. */
export function declaredLength(headers: Headers): number | undefined {
    const value = headers.get('content-length')?.trim()
    return value && /^\d+$/.test(value) ? Number(value) : undefined
}

type ReadOptions = {
    limit: number
    /** The deadline (and the client's disconnect). */
    signal: AbortSignal
}

/**
 * Reads a body of at most `limit` bytes into memory before `signal` aborts.
 * Rejects with BodyTooLargeError, or with the signal's reason, once the
 * source is unlocked again. The source is not cancelled: cancelling a Node
 * request destroys its socket, so the client would get a connection reset
 * instead of the 413 or 408 (see discardBody).
 */
export async function readBody(body: ReadableStream<Uint8Array>, { limit, signal }: ReadOptions) {
    const limiter = byteLimit(limit)
    const piped = body
        .pipeTo(limiter.writable, {
            preventCancel: true,
            signal,
        })
        .catch(() => {})
    const reader = limiter.readable.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            size += value.byteLength
        }
    } finally {
        await piped
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return bytes
}

/**
 * Reads and discards what is left of a rejected body, for at most `ms`, so
 * the client finishes sending and reads the error instead of a connection
 * reset. Past `ms` the request is cancelled, which closes the connection.
 */
export function discardBody(body: ReadableStream<Uint8Array>, ms: number): void {
    if (body.locked) return
    body.pipeTo(new WritableStream(), {
        signal: AbortSignal.timeout(ms),
    }).catch(() => {})
}
