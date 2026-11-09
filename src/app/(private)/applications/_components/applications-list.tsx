'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { applicationQueries } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { ApplicationItem } from './application-item'

/** Cursor pagination with useInfiniteQuery; page 1 arrives hydrated from the server. */
export function ApplicationsList() {
    const t = useTranslations('applications.list')
    const applications = useInfiniteQuery(applicationQueries.list(browserApi))
    const items = applications.data?.pages.flatMap(page => page.items) ?? []

    return (
        <section
            aria-labelledby="applications-list-title"
            className="grid max-w-3xl content-start gap-4"
        >
            <h2
                id="applications-list-title"
                className="text-xl font-semibold"
            >
                {t('title')}
            </h2>

            {applications.isPending && (
                <div className="grid gap-3">
                    <p
                        role="status"
                        className="sr-only"
                    >
                        {t('loading')}
                    </p>
                    {Array.from(
                        {
                            length: 4,
                        },
                        (_, index) => (
                            <Skeleton
                                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
                                key={index}
                                className="h-20"
                            />
                        ),
                    )}
                </div>
            )}

            {applications.isError && !applications.data && (
                <div
                    role="alert"
                    className="grid justify-items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
                >
                    <p>{t('error')}</p>
                    <Button
                        variant="outline"
                        onClick={() => applications.refetch()}
                    >
                        {t('retry')}
                    </Button>
                </div>
            )}

            {applications.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}

            {items.length > 0 && (
                <ul
                    className="grid gap-3"
                    aria-label={t('title')}
                >
                    {items.map(application => (
                        <ApplicationItem
                            key={application.id}
                            application={application}
                        />
                    ))}
                </ul>
            )}

            {applications.hasNextPage ? (
                <div>
                    {/* Stays focusable while loading (aria-disabled, not disabled). */}
                    <Button
                        variant="outline"
                        aria-busy={applications.isFetchingNextPage || undefined}
                        aria-disabled={applications.isFetchingNextPage || undefined}
                        onClick={() => {
                            if (!applications.isFetchingNextPage) applications.fetchNextPage()
                        }}
                    >
                        {applications.isFetchingNextPage && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {applications.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
                    </Button>
                </div>
            ) : (
                applications.isSuccess
                && items.length > 0 && <p className="text-sm text-muted-foreground">{t('end')}</p>
            )}
            {applications.isFetchNextPageError && (
                <p
                    role="alert"
                    className="text-sm text-destructive"
                >
                    {t('error')}
                </p>
            )}
        </section>
    )
}
