'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { applicationQueries } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { ApplicationCvBlock } from './application-cv'
import { ApplicationMessages } from './application-messages'
import { ApplyHeader } from './apply-header'
import { VacancyDetails } from './vacancy-details'

/**
 * The application as a place to apply from: what to open and the status on
 * top, the messages to copy, then the CV and the vacancy. From the hydrated
 * cache; refetches in the background when stale, and every few seconds while
 * the vacancy is read or the CV or the messages are written.
 */
export function ApplicationView({ id }: { id: string }) {
    const t = useTranslations('applications.detail')
    const { data: application } = useQuery(applicationQueries.detail(browserApi, id))
    if (!application) return null
    const { vacancy } = application
    // A vacancy keeps the text it was read from; one added by hand has only its own.
    const originalText = vacancy?.rawText.trim() ? vacancy.rawText : application.vacancyText
    return (
        <article className="grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-8">
            <Link
                href="/applications"
                className="w-fit rounded-sm text-sm text-primary underline underline-offset-4 hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
            >
                ← {t('back')}
            </Link>
            <ApplyHeader application={application} />
            <ApplicationMessages application={application} />
            <ApplicationCvBlock
                applicationId={application.id}
                cv={application.cv}
                vacancy={vacancy}
            />
            {vacancy && <VacancyDetails vacancy={vacancy} />}
            {originalText.trim() ? (
                <details className="rounded-lg border border-border p-4">
                    <summary className="cursor-pointer rounded-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden">
                        {t('originalText')}
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap break-words">{originalText}</p>
                </details>
            ) : (
                !vacancy && <p className="text-muted-foreground">{t('emptyVacancyText')}</p>
            )}
        </article>
    )
}
