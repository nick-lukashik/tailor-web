import { isApiError } from '@/lib/api/errors'
import { type VacancyIntakeItem, type VacancyIntakeResult } from '@/lib/api/types'
import { INTAKE_MAX_ITEMS } from '@/lib/api/vacancies'
import { MAX_BODY_BYTES } from '@/lib/http/body-limit'

/** tailor-api's limits of one intake item (`vacancyIntakeItemSchema`). */
export const URL_MAX = 2048
export const TEXT_MAX = 100_000
/** A file larger than this is refused before it is read. */
export const IMPORT_FILE_MAX_BYTES = 50 * 1024 * 1024
/** Room under the /api proxy's 1 MiB cap for anything but the JSON itself. */
export const CHUNK_MAX_BYTES = MAX_BODY_BYTES - 16 * 1024

export type ImportItemIssue = {
    /** 0-based index in the file. */
    item: number
    reason: 'notObject' | 'url' | 'text' | 'empty' | 'unknownKey'
}

export type ImportProblem =
    | {
          kind: 'tooLarge' | 'notJson' | 'shape' | 'empty'
      }
    | {
          kind: 'items'
          issues: ImportItemIssue[]
      }

const HTTP_URL = /^https?:\/\/\S+$/

/** One item of the file as the intake takes it, or what is wrong with it. */
function itemOf(value: unknown, item: number): VacancyIntakeItem | ImportItemIssue {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {
            item,
            reason: 'notObject',
        }
    const { url, text, ...rest } = value as Record<string, unknown>
    if (Object.keys(rest).length > 0)
        return {
            item,
            reason: 'unknownKey',
        }
    if (url !== undefined && (typeof url !== 'string' || url.length > URL_MAX || !HTTP_URL.test(url.trim())))
        return {
            item,
            reason: 'url',
        }
    if (text !== undefined && (typeof text !== 'string' || text.length > TEXT_MAX))
        return {
            item,
            reason: 'text',
        }
    const link = typeof url === 'string' ? url.trim() : ''
    const body = typeof text === 'string' && text.trim() ? text : ''
    if (!link && !body)
        return {
            item,
            reason: 'empty',
        }
    return {
        ...(link
            ? {
                  url: link,
              }
            : {}),
        ...(body
            ? {
                  text: body,
              }
            : {}),
    }
}

/**
 * The items of an import file, `{ "items": [{ "url"?, "text"? }] }` (the intake
 * body, any number of items), checked as tailor-api would check each one.
 */
export function importItems(source: string):
    | {
          items: VacancyIntakeItem[]
      }
    | {
          problem: ImportProblem
      } {
    let data: unknown
    try {
        data = JSON.parse(source)
    } catch {
        return {
            problem: {
                kind: 'notJson',
            },
        }
    }
    const list = (
        data as {
            items?: unknown
        } | null
    )?.items
    if (typeof data !== 'object' || data === null || Array.isArray(data) || !Array.isArray(list))
        return {
            problem: {
                kind: 'shape',
            },
        }
    if (list.length === 0)
        return {
            problem: {
                kind: 'empty',
            },
        }
    const items: VacancyIntakeItem[] = []
    const issues: ImportItemIssue[] = []
    list.forEach((value, index) => {
        const checked = itemOf(value, index)
        if ('reason' in checked) issues.push(checked)
        else items.push(checked)
    })
    if (issues.length > 0)
        return {
            problem: {
                kind: 'items',
                issues,
            },
        }
    return {
        items,
    }
}

const encoder = new TextEncoder()
const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
/** `{"items":[]}`: the body around the items. */
const ENVELOPE_BYTES = bytesOf({
    items: [],
})

export type ImportChunk = {
    /** 0-based index of the chunk's first item in the file. */
    from: number
    items: VacancyIntakeItem[]
}

/**
 * Requests of at most `maxItems` items and `maxBytes` of JSON each, in file
 * order. An item too large on its own still gets a request of its own (the
 * API answers for it).
 */
export function chunkItems(
    items: VacancyIntakeItem[],
    { maxItems = INTAKE_MAX_ITEMS, maxBytes = CHUNK_MAX_BYTES } = {},
): ImportChunk[] {
    const chunks: ImportChunk[] = []
    let current: ImportChunk | null = null
    let size = ENVELOPE_BYTES
    for (const [index, item] of items.entries()) {
        const itemBytes = bytesOf(item)
        // After the first item, its comma too.
        const added = current ? itemBytes + 1 : itemBytes
        if (!current || current.items.length >= maxItems || size + added > maxBytes) {
            current = {
                from: index,
                items: [],
            }
            chunks.push(current)
            size = ENVELOPE_BYTES + itemBytes
        } else size += added
        current.items.push(item)
    }
    return chunks
}

export type ChunkFailure = {
    from: number
    count: number
    error: unknown
}

export type ImportOutcome = {
    created: number
    existing: number
    failures: ChunkFailure[]
}

/**
 * Sends the chunks one after another (the API takes them in order, and one
 * failure does not stop the rest), adding up what was created and found.
 */
export async function sendChunks(
    chunks: ImportChunk[],
    send: (items: VacancyIntakeItem[]) => Promise<VacancyIntakeResult>,
    onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
    const outcome: ImportOutcome = {
        created: 0,
        existing: 0,
        failures: [],
    }
    for (const [index, chunk] of chunks.entries()) {
        try {
            const result = await send(chunk.items)
            outcome.created += result.created
            outcome.existing += result.existing
        } catch (error) {
            outcome.failures.push({
                from: chunk.from,
                count: chunk.items.length,
                error,
            })
        }
        onProgress?.(index + 1, chunks.length)
    }
    return outcome
}

/** What the API said about a failed chunk: its first validation message, else nothing specific. */
export function chunkErrorMessage(error: unknown): string | null {
    if (!isApiError(error)) return null
    const issue = error.details[0]
    if (error.code === 'VALIDATION_FAILED') return issue ? `${issue.path}: ${issue.message}` : error.message
    return error.status === 413 ? null : error.code === 'CONFLICT' ? error.message : null
}
