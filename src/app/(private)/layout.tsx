import { type Metadata } from 'next'
import { type ReactNode } from 'react'
import { InvitationNotice } from '@/components/access/invitation-notice'
import { SignInNotice } from '@/components/access/sign-in-notice'
import { serverEnv } from '@/lib/env/server'
import { requestAccess } from '@/lib/session/access'
import { accounts } from '@/lib/session/session'

/** The person's own work, not content: never indexed, never in the sitemap. */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
}

/**
 * Every page but the home page needs a signed-in person on tailor-api's allowlist
 * (D-112). Signed out: an offer to sign in, back to this page. Not invited: the
 * invitation page with the person's user id. tailor-api checks the same on every
 * call, so this is what the person sees, not the lock.
 */
export default async function PrivateLayout({ children }: { children: ReactNode }) {
    const access = await requestAccess()
    if (access.state === 'signed-out' && accounts)
        return (
            <SignInNotice
                accountSite={accounts.idUrl}
                site={serverEnv.SITE_URL}
            />
        )
    if (access.state === 'not-invited') return <InvitationNotice userId={access.userId} />
    return children
}
