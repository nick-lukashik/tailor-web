import { createApiClient } from './client'

/**
 * The browser's client: same-origin /api, which src/app/api/[...path]
 * forwards to API_URL. No CORS, and the CSP keeps connect-src 'self'.
 */
export const browserApi = createApiClient({
    baseUrl: '',
})
