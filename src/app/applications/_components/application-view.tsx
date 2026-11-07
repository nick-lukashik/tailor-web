'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { applicationQueries } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { useApplicationDate } from './application-date'
import { StatusBadge } from './status-badge'

/**
 * The application from the hydrated cache; refetches in the background when
 * stale. `demoCvUrl` is the mock CV on cv.<domain> until the pipeline makes real ones.
 */
export function ApplicationView({ id, demoCvUrl }: { id: string; demoCvUrl: string }) {
    const t = useTranslations('applications.detail')
    const formatDate = useApplicationDate()
    const { data: application } = useQuery(applicationQueries.detail(browserApi, id))
    if (!application) return null
    return (
        <article className="grid max-w-3xl gap-4">
            <Link
                href="/applications"
                className="text-sm text-primary underline underline-offset-4 hover:no-underline"
            >
                ← {t('back')}
            </Link>
            <header className="grid gap-2">
                <h1 className="text-3xl font-bold tracking-tight break-words">{application.company}</h1>
                {application.role && <p className="text-lg text-muted-foreground">{application.role}</p>}
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <StatusBadge status={application.status} />
                    <span>
                        {t.rich('createdAt', {
                            date: formatDate(application.createdAt),
                            time: chunks => <time dateTime={application.createdAt}>{chunks}</time>,
                        })}
                    </span>
                </div>
            </header>
            <div className="flex flex-wrap gap-3">
                <Button asChild>
                    <a
                        href={demoCvUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('demoCv')}
                    </a>
                </Button>
                {application.vacancyUrl && (
                    <Button
                        asChild
                        variant="outline"
                    >
                        <a
                            href={application.vacancyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t('vacancyLink')}
                        </a>
                    </Button>
                )}
            </div>
            <section
                aria-labelledby="vacancy-text-title"
                className="grid gap-2"
            >
                <h2
                    id="vacancy-text-title"
                    className="text-xl font-semibold"
                >
                    {t('vacancyText')}
                </h2>
                {application.vacancyText ? (
                    <p className="whitespace-pre-wrap">{application.vacancyText}</p>
                ) : (
                    <p className="text-muted-foreground">{t('emptyVacancyText')}</p>
                )}
            </section>
        </article>
    )
}
