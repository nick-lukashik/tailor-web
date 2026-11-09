import { NextResponse } from 'next/server'
import { applicationsApi } from '@/lib/api/applications'
import { isApiError } from '@/lib/api/errors'
import { serverApi } from '@/lib/api/server'
import { serverEnv } from '@/lib/env/server'
import { mayEnter, requestAccess } from '@/lib/session/access'
import { httpUrl } from '../../_components/vacancy-format'

export const dynamic = 'force-dynamic'

const noStore = {
    'cache-control': 'private, no-store',
}

/**
 * "Open CV" of a list row: the rows carry no CV link, so this asks tailor-api
 * for the application and sends the browser to its newest ready CV (307), or
 * to the application page when there is none. src/proxy.ts has already let in
 * only a person with the `tailor` role; tailor-api answers only their own.
 */
export async function GET(_request: Request, { params }: RouteContext<'/applications/[id]/cv'>) {
    const { id } = await params
    if (!mayEnter(await requestAccess()))
        return new NextResponse(null, {
            status: 404,
            headers: noStore,
        })
    const page = new URL(`/applications/${encodeURIComponent(id)}`, serverEnv.SITE_URL)
    try {
        const application = await applicationsApi.get(await serverApi(), id)
        const cv = httpUrl(application.cv.url)
        const response = NextResponse.redirect(cv ?? page, 307)
        response.headers.set('cache-control', noStore['cache-control'])
        return response
    } catch (error) {
        if (isApiError(error) && error.code === 'NOT_FOUND')
            return new NextResponse(null, {
                status: 404,
                headers: noStore,
            })
        const response = NextResponse.redirect(page, 307)
        response.headers.set('cache-control', noStore['cache-control'])
        return response
    }
}
