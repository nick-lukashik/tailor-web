'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

/** A private page without a session: sign in at the account site, which comes back here. */
export function SignInNotice({ accountSite, site }: { accountSite: string; site: string }) {
    const t = useTranslations('access.signIn')
    const back = `${site}${usePathname()}`
    return (
        <section className="mx-auto grid max-w-xl gap-4 py-10">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground">{t('body')}</p>
            <div>
                <Button asChild>
                    <a
                        href={`${accountSite}/login?continue=${encodeURIComponent(back)}`}
                        rel="nofollow"
                    >
                        {t('action')}
                    </a>
                </Button>
            </div>
        </section>
    )
}
