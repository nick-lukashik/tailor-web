import { isApiError } from '@/lib/api/errors'

/**
 * What to tell the person about a failed request: tailor-api's own words for a
 * conflict with the current state (a 409 says what is in the way), else the
 * caller's plain fallback.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
    return isApiError(error) && error.code === 'CONFLICT' && error.message.trim() ? error.message : fallback
}
