/** Error codes of the backend contract. */
export const contractErrorCodes = [
    'VALIDATION_FAILED',
    /** No valid access token: sign in (again). */
    'UNAUTHORIZED',
    /** Signed in, but the token lacks the `tailor` role (or a cross-site write). */
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
    'INTERNAL',
] as const
export type ContractErrorCode = (typeof contractErrorCodes)[number]

/** Contract codes plus UNAVAILABLE: no answer (network, timeout, gateway). */
export type ApiErrorCode = ContractErrorCode | 'UNAVAILABLE'

export type ApiIssue = {
    path: string
    message: string
}

/** Error body of the contract: `{ code, message, details?, requestId }`. */
export type ApiErrorBody = {
    code: ContractErrorCode
    message: string
    details?: {
        path: unknown
        message: string
    }[]
    requestId: string
}

export class ApiError extends Error {
    override readonly name = 'ApiError'

    constructor(
        /** HTTP status; 0 when no response arrived. */
        readonly status: number,
        readonly code: ApiErrorCode,
        message: string,
        readonly details: ApiIssue[] = [],
        readonly requestId?: string,
    ) {
        super(message)
    }

    /** First message per top-level field, from VALIDATION_FAILED details. */
    fieldErrors(): Record<string, string> {
        const fields: Record<string, string> = {}
        for (const { path, message } of this.details) {
            const field = fieldOf(path)
            if (field && !(field in fields)) fields[field] = message
        }
        return fields
    }

    /** Worth retrying automatically: the request may succeed later. */
    get retryable(): boolean {
        return this.code === 'UNAVAILABLE' || this.status >= 500
    }
}

export function isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError
}

/** `a.b.0`, `["a", "b", 0]` → `a.b.0`: the whole path of an issue, `""` for the document itself. */
export function pathOf(path: unknown): string {
    return Array.isArray(path) ? path.map(String).join('.') : String(path ?? '')
}

/** `title`, `/title`, `body.title`, `["title"]` → `title`. */
export function fieldOf(path: unknown): string {
    const first = Array.isArray(path) ? path[0] : path
    const parts = String(first ?? '')
        .split(/[./]/)
        .filter(Boolean)
    return (parts[0] === 'body' && parts.length > 1 ? parts[1] : parts[0]) ?? ''
}

function isErrorBody(value: unknown): value is ApiErrorBody {
    if (typeof value !== 'object' || value === null) return false
    const { code, message } = value as Record<string, unknown>
    return typeof message === 'string' && contractErrorCodes.includes(code as ContractErrorCode)
}

function codeForStatus(status: number): ApiErrorCode {
    if (status === 400 || status === 422) return 'VALIDATION_FAILED'
    if (status === 401) return 'UNAUTHORIZED'
    if (status === 403) return 'FORBIDDEN'
    if (status === 404) return 'NOT_FOUND'
    if (status === 429) return 'RATE_LIMITED'
    if (status === 502 || status === 503 || status === 504) return 'UNAVAILABLE'
    return 'INTERNAL'
}

/** Maps a non-2xx response to an ApiError, contract body or not. */
export function toApiError(status: number, body: unknown, requestId?: string): ApiError {
    if (isErrorBody(body)) {
        const details = (body.details ?? []).map(issue => ({
            path: pathOf(issue.path),
            message: issue.message,
        }))
        return new ApiError(status, body.code, body.message, details, body.requestId || requestId)
    }
    return new ApiError(status, codeForStatus(status), `HTTP ${status}`, [], requestId)
}
