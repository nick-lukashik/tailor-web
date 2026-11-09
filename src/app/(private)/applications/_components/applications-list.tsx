'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2Icon, SearchIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { applicationQueries } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { cn } from '@/lib/utils'
import { ApplicationItem } from './application-item'
import { filterApplications, matchesSearch, STAGE_FILTERS, type StageFilter, stageCounts, stageFilterOf } from './stage'

/** `?stage=` and `?q=` of the list, kept in the address without a navigation (Next syncs useSearchParams). */
function setParam(name: string, value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(name, value)
    else url.searchParams.delete(name)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Cursor pagination with useInfiniteQuery; page 1 arrives hydrated from the
 * server. The stage chips and the search work on the loaded pages.
 */
export function ApplicationsList() {
    const t = useTranslations('applications')
    const params = useSearchParams()
    const filter = stageFilterOf(params.get('stage'))
    const [query, setQuery] = useState(() => params.get('q') ?? '')
    const applications = useInfiniteQuery(applicationQueries.list(browserApi))
    const items = applications.data?.pages.flatMap(page => page.items) ?? []
    const searched = items.filter(item => matchesSearch(item, query))
    const counts = stageCounts(searched)
    const shown = filterApplications(items, filter, query)

    const choose = (next: StageFilter) => setParam('stage', next === 'all' ? '' : next)
    const search = (value: string) => {
        setQuery(value)
        setParam('q', value.trim())
    }
    const narrowed = filter !== 'all' || query.trim() !== ''

    return (
        <section
            aria-labelledby="applications-list-title"
            className="grid max-w-3xl grid-cols-[minmax(0,1fr)] content-start gap-4"
        >
            <h2
                id="applications-list-title"
                className="text-xl font-semibold"
            >
                {t('list.title')}
            </h2>

            <div className="grid gap-3">
                <div className="relative max-w-md">
                    <SearchIcon
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        type="search"
                        value={query}
                        onChange={event => search(event.target.value)}
                        aria-label={t('filters.search')}
                        placeholder={t('filters.search')}
                        autoComplete="off"
                        className="pl-8"
                    />
                </div>
                <fieldset className="flex min-w-0 flex-wrap gap-1.5">
                    <legend className="sr-only">{t('filters.label')}</legend>
                    {STAGE_FILTERS.map(value => {
                        const current = value === filter
                        return (
                            <Button
                                key={value}
                                type="button"
                                size="sm"
                                variant={current ? 'default' : 'outline'}
                                aria-pressed={current}
                                onClick={() => choose(value)}
                                className="rounded-full"
                            >
                                {value === 'all' ? t('filters.all') : t(`stage.${value}`)}{' '}
                                <span
                                    className={cn(
                                        'min-w-5 rounded-full px-1.5 text-xs tabular-nums',
                                        current ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
                                    )}
                                >
                                    {applications.isPending ? '–' : counts[value]}
                                </span>
                            </Button>
                        )
                    })}
                </fieldset>
                {applications.hasNextPage && narrowed && (
                    <p className="text-xs text-muted-foreground">
                        {t('filters.partial', {
                            count: items.length,
                        })}
                    </p>
                )}
            </div>

            {applications.isPending && (
                <div className="grid gap-3">
                    <p
                        role="status"
                        className="sr-only"
                    >
                        {t('list.loading')}
                    </p>
                    {Array.from(
                        {
                            length: 4,
                        },
                        (_, index) => (
                            <Skeleton
                                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
                                key={index}
                                className="h-24"
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
                    <p>{t('list.error')}</p>
                    <Button
                        variant="outline"
                        onClick={() => applications.refetch()}
                    >
                        {t('list.retry')}
                    </Button>
                </div>
            )}

            {applications.isSuccess && shown.length === 0 && (
                <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-border p-6">
                    <p className="text-muted-foreground">
                        {query.trim()
                            ? t('filters.noMatch', {
                                  query: query.trim(),
                              })
                            : t(`filters.empty.${filter}`)}
                    </p>
                    {narrowed && (
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="px-0"
                            onClick={() => {
                                search('')
                                choose('all')
                            }}
                        >
                            {t('filters.showAll')}
                        </Button>
                    )}
                </div>
            )}

            {shown.length > 0 && (
                <ul
                    className="grid gap-3"
                    aria-label={t('list.title')}
                >
                    {shown.map(application => (
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
                        {applications.isFetchingNextPage ? t('list.loadingMore') : t('list.loadMore')}
                    </Button>
                </div>
            ) : (
                applications.isSuccess
                && items.length > 0 && <p className="text-sm text-muted-foreground">{t('list.end')}</p>
            )}
            {applications.isFetchNextPageError && (
                <p
                    role="alert"
                    className="text-sm text-destructive"
                >
                    {t('list.error')}
                </p>
            )}
        </section>
    )
}
