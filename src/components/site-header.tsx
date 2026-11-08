'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type AppLocale } from '@/i18n/config'
import { type Account } from '@/lib/session/session'
import { cn } from '@/lib/utils'
import { LocaleSwitch } from './locale-switch'

const links = [
    {
        href: '/',
        label: 'home',
    },
    {
        href: '/applications',
        label: 'applications',
    },
    {
        href: '/profile',
        label: 'profile',
    },
] as const

const quiet =
    'inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground'

/**
 * `account`: the person signed in, null when nobody is, undefined while the site
 * has no accounts (no sign-in link then). Sign-in is a plain link to the account
 * site, back to this page; sign-out a plain form: both reload the page anyway.
 * (landing-web's header.)
 */
export function SiteHeader({
    languageNames,
    account,
    accountSite,
    site,
}: {
    languageNames: Record<AppLocale, string>
    account?: Account | null
    accountSite?: string
    site: string
}) {
    const t = useTranslations('nav')
    const pathname = usePathname()
    const isCurrent = (href: string) =>
        href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

    return (
        <header className="border-b bg-background">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
                <nav
                    aria-label={t('label')}
                    className="flex items-center gap-1"
                >
                    {links.map(link => (
                        <Link
                            key={link.href}
                            href={link.href}
                            aria-current={isCurrent(link.href) ? 'page' : undefined}
                            className={cn(
                                'inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground',
                                'aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-4',
                            )}
                        >
                            {t(link.label)}
                        </Link>
                    ))}
                </nav>
                <div className="flex flex-wrap items-center gap-1">
                    {account === null ? (
                        <a
                            href={`${accountSite}/login?continue=${encodeURIComponent(`${site}${pathname}`)}`}
                            rel="nofollow"
                            className={quiet}
                        >
                            {t('signIn')}
                        </a>
                    ) : account ? (
                        <>
                            <a
                                href={`${accountSite}/account`}
                                className={quiet}
                                title={
                                    account.email
                                        ? t('signedInAs', {
                                              name: account.email,
                                          })
                                        : undefined
                                }
                            >
                                {account.name ?? account.email ?? t('account')}
                            </a>
                            <form
                                action="/auth/sign-out"
                                method="post"
                            >
                                <button
                                    type="submit"
                                    className={quiet}
                                >
                                    {t('signOut')}
                                </button>
                            </form>
                        </>
                    ) : null}
                    <LocaleSwitch names={languageNames} />
                </div>
            </div>
        </header>
    )
}
