import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { type Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { applicationKeys } from '@/lib/api/applications'
import { serverEnv } from '@/lib/env/server'
import { getServerQueryClient } from '@/lib/query/server'
import { ApplicationView } from '../_components/application-view'
import { loadApplication } from '../load-application'

export async function generateMetadata({ params }: PageProps<'/applications/[id]'>): Promise<Metadata> {
    const { id } = await params
    const [application, t] = await Promise.all([
        loadApplication(id),
        getTranslations('applications.meta'),
    ])
    return {
        title: application.role ? `${application.company}: ${application.role}` : application.company,
        description: t('description'),
    }
}

/**
 * No loading.tsx on purpose: a streamed shell would commit status 200 before
 * notFound() could answer 404. (The list's loading.tsx sits in the (list)
 * route group so it does not wrap this route.)
 */
export default async function ApplicationPage({ params }: PageProps<'/applications/[id]'>) {
    const { id } = await params
    const application = await loadApplication(id)
    // Seed the client cache with what the server already has: no second fetch.
    const queryClient = getServerQueryClient()
    queryClient.setQueryData(applicationKeys.detail(id), application)
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <ApplicationView
                id={id}
                // tailor-api redirects the id to <id>/<Name-Role-CV>.pdf.
                cvUrl={`${serverEnv.CV_URL}/${encodeURIComponent(id)}`}
            />
        </HydrationBoundary>
    )
}
