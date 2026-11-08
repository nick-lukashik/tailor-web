import { type NextRequest, NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env/server'
import { accounts, cookieName, endSession, expiredSessionCookie, openSession } from '@/lib/session/session'

export const dynamic = 'force-dynamic'

/** A redirect to a path of this site or to the landing (303: the next request is a GET). Never stored by a cache. */
function to(path: string) {
    const response = NextResponse.redirect(new URL(path, serverEnv.SITE_URL), 303)
    response.headers.set('cache-control', 'private, no-store')
    return response
}

/**
 * "Sign out" (a POST from the header's form) signs out of the whole account: the
 * session ends at id-api and the cookie goes, for every site under the domain. When
 * id-api could not end it the cookie stays and the person is told: a page saying
 * "signed out" over a session that is still alive would be a lie.
 */
export async function POST(request: NextRequest) {
    if (!accounts)
        return new NextResponse(null, {
            status: 404,
            headers: {
                'cache-control': 'private, no-store',
            },
        })
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(serverEnv.SITE_URL).origin)
        return new NextResponse(null, {
            status: 403,
        })
    const name = cookieName()
    const session = openSession(accounts, request.cookies.get(name)?.value)
    if (session && !(await endSession(accounts, session))) return to('/auth/error')
    // Signed out, nothing here is for this person any more: straight to the landing.
    const response = to(serverEnv.HOME_URL)
    response.cookies.set(name, '', expiredSessionCookie())
    return response
}
