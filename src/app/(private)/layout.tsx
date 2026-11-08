import { type Metadata, type Route } from 'next'
import { redirect } from 'next/navigation'
import { type ReactNode } from 'react'
import { serverEnv } from '@/lib/env/server'
import { mayEnter, requestAccess } from '@/lib/session/access'

/** The person's own work, not content: never indexed. */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
}

/**
 * Every page needs a signed-in person whose token carries the `tailor` role. src/proxy.ts
 * sends anyone else to the platform's landing before rendering; this catches what only
 * tailor-api can tell (a token it refuses, a session ended elsewhere) the same way, with
 * no message. tailor-api checks the same on every call, so this is what the person sees,
 * not the lock.
 */
export default async function PrivateLayout({ children }: { children: ReactNode }) {
    // An external URL: typed routes know only this site's paths.
    if (!mayEnter(await requestAccess())) redirect(serverEnv.HOME_URL as Route)
    return children
}
