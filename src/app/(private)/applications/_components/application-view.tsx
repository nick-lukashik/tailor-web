'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { applicationQueries } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { applicationRole, applicationTitle } from '../application-title'
import { ApplicationCvBlock } from './application-cv'
import { useApplicationDate } from './application-date'
import { StatusBadge } from './status-badge'
import { VacancyDetails } from './vacancy-details'
import { httpUrl } from './vacancy-format'

/**
 * The application from the hydrated cache; refetches in the background when
 * stale, and every few seconds while its vacancy is being read.
 */
export function ApplicationView({ id }: { id: string }) {
    const t = useTranslations('applications.detail')
    const tApplications = useTranslations('applications')
    const formatDate = useApplicationDate()
    const { data: application } = useQuery(applicationQueries.detail(browserApi, id))
    if (!application) return null
    const { vacancy } = application
    const role = applicationRole(application)
    const vacancyUrl = httpUrl(vacancy?.url ?? application.vacancyUrl)
    // A vacancy keeps the text it was read from; one added by hand has only its own.
    const originalText = vacancy?.rawText.trim() ? vacancy.rawText : application.vacancyText
    return (
        <article className="grid max-w-3xl gap-6">
            <Link
                href="/applications"
                className="text-sm text-primary underline underline-offset-4 hover:no-underline"
            >
                ← {t('back')}
            </Link>
            <header className="grid gap-2">
                <h1 className="text-3xl font-bold tracking-tight break-words">
                    {applicationTitle(application) ?? tApplications('untitled')}
                </h1>
                {role && <p className="text-lg text-muted-foreground">{role}</p>}
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <StatusBadge status={application.status} />
                    <span>
                        {t.rich('createdAt', {
                            date: formatDate(application.createdAt),
                            time: chunks => <time dateTime={application.createdAt}>{chunks}</time>,
                        })}
                    </span>
                    {vacancy?.model && (
                        <span className="text-xs">
                            {t('model', {
                                model: vacancy.model,
                            })}
                        </span>
                    )}
                </div>
                {vacancyUrl && (
                    <div>
                        <Button
                            asChild
                            variant="outline"
                        >
                            <a
                                href={vacancyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t('vacancyLink')}
                            </a>
                        </Button>
                    </div>
                )}
            </header>
            {vacancy && <VacancyDetails vacancy={vacancy} />}
            {originalText.trim() ? (
                <details className="rounded-lg border border-border p-4">
                    <summary className="cursor-pointer font-semibold">{t('originalText')}</summary>
                    <p className="mt-3 whitespace-pre-wrap break-words">{originalText}</p>
                </details>
            ) : (
                !vacancy && <p className="text-muted-foreground">{t('emptyVacancyText')}</p>
            )}
            <ApplicationCvBlock cv={application.cv} />
        </article>
    )
}
