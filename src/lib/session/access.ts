import 'server-only'
import { cache } from 'react'
import { isApiError } from '@/lib/api/errors'
import { profileApi } from '@/lib/api/profile'
import { serverApi } from '@/lib/api/server'
import { requestSession } from './request'
import { accounts } from './session'

/**
 * Whether this request may see Tailor's private pages:
 * - `open`: the site has no accounts (local work against the mock), nothing is checked;
 * - `signed-out`: no session, the page offers "Sign in";
 * - `not-invited`: signed in, not on tailor-api's allowlist (D-112), with the id to send;
 * - `invited`: in. Also when tailor-api cannot say: the page then shows its own error.
 */
export type Access =
    | {
          state: 'open'
      }
    | {
          state: 'signed-out'
      }
    | {
          state: 'not-invited'
          userId: string
      }
    | {
          state: 'invited'
      }

/** One call to tailor-api `GET /me` per request (React cache), only with a session. */
export const requestAccess = cache(async (): Promise<Access> => {
    if (!accounts)
        return {
            state: 'open',
        }
    if (!(await requestSession()))
        return {
            state: 'signed-out',
        }
    try {
        const me = await profileApi.me(await serverApi())
        return me.invited
            ? {
                  state: 'invited',
              }
            : {
                  state: 'not-invited',
                  userId: me.userId,
              }
    } catch (error) {
        // The token was refused (a session ended elsewhere): sign in again.
        if (isApiError(error) && error.code === 'UNAUTHORIZED')
            return {
                state: 'signed-out',
            }
        return {
            state: 'invited',
        }
    }
})

/** The page may render its data. */
export const mayEnter = (access: Access) => access.state === 'open' || access.state === 'invited'
