import 'server-only'
import { cache } from 'react'
import { isApiError } from '@/lib/api/errors'
import { profileApi } from '@/lib/api/profile'
import { serverApi } from '@/lib/api/server'
import { requestSession } from './request'
import { accounts } from './session'

/**
 * Whether this request may see Tailor's pages. src/proxy.ts already sent away anyone
 * without a session or without the `tailor` role in the token; this asks tailor-api,
 * which verifies the token:
 * - `open`: the site has no accounts (local work against the mock), nothing is checked;
 * - `denied`: no session, a token tailor-api refuses, or no `tailor` role;
 * - `allowed`: in. Also when tailor-api cannot say: the page then shows its own error.
 */
export type Access = {
    state: 'open' | 'denied' | 'allowed'
}

/** One call to tailor-api `GET /me` per request (React cache), only with a session. */
export const requestAccess = cache(async (): Promise<Access> => {
    if (!accounts)
        return {
            state: 'open',
        }
    if (!(await requestSession()))
        return {
            state: 'denied',
        }
    try {
        const me = await profileApi.me(await serverApi())
        return {
            state: me.allowed ? 'allowed' : 'denied',
        }
    } catch (error) {
        // The token was refused (a session ended elsewhere).
        if (isApiError(error) && error.code === 'UNAUTHORIZED')
            return {
                state: 'denied',
            }
        return {
            state: 'allowed',
        }
    }
})

/** The page may render its data. */
export const mayEnter = (access: Access) => access.state !== 'denied'
