import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { accounts } from '@/lib/session/session'

export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
}

/** A sign-out that id-api could not do: the person is still signed in, and can try again. */
export default async function AuthErrorPage() {
    if (!accounts) notFound()
    const t = await getTranslations('authError')
    return (
        <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-10">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p>{t('body')}</p>
            <Button asChild>
                <a href="/">{t('back')}</a>
            </Button>
        </div>
    )
}
