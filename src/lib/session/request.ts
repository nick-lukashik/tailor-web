import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { accounts, cookieName, openSession, type Session } from './session'

/**
 * The session of this request, for Server Components: the cookie as src/proxy.ts left
 * it, refreshed there when its token was about to expire (the proxy rewrites the
 * request's cookie too). Undefined without accounts or without a session.
 */
export const requestSession = cache(async (): Promise<Session | undefined> => {
    if (!accounts) return undefined
    return openSession(accounts, (await cookies()).get(cookieName())?.value)
})
