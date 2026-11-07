import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { type Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { applicationQueries } from '@/lib/api/applications'
import { serverApi } from '@/lib/api/server'
import { getServerQueryClient } from '@/lib/query/server'
import { ApplicationsList } from '../_components/applications-list'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('applications.meta')
    return {
        title: t('title'),
        description: t('description'),
    }
}

const ignore = () => {}

/**
 * Server prefetch → HydrationBoundary → client query. The first page is in
 * the HTML; the client takes the same cache over without refetching. A
 * failed prefetch is not fatal: the list retries and shows its error state.
 */
export default async function ApplicationsPage() {
    const [t, api] = await Promise.all([
        getTranslations('applications'),
        serverApi(),
    ])
    const queryClient = getServerQueryClient()
    await queryClient.infiniteQuery(applicationQueries.list(api)).catch(ignore)

    return (
        <div className="grid gap-8">
            <header className="grid gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{t('heading')}</h1>
                <p className="max-w-2xl text-muted-foreground">{t('lead')}</p>
            </header>
            <HydrationBoundary state={dehydrate(queryClient)}>
                <ApplicationsList />
            </HydrationBoundary>
        </div>
    )
}
