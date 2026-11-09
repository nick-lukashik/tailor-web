import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { type Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { applicationKeys } from '@/lib/api/applications'
import { getServerQueryClient } from '@/lib/query/server'
import { mayEnter, requestAccess } from '@/lib/session/access'
import { ApplicationView } from '../_components/application-view'
import { applicationRole, applicationTitle } from '../application-title'
import { loadApplication } from '../load-application'

export async function generateMetadata({ params }: PageProps<'/applications/[id]'>): Promise<Metadata> {
    const { id } = await params
    const t = await getTranslations('applications')
    // Without access the layout sends the visitor away, and nothing names the application.
    if (!mayEnter(await requestAccess()))
        return {
            title: t('meta.title'),
            description: t('meta.description'),
        }
    const application = await loadApplication(id)
    const name = applicationTitle(application) ?? t('untitled')
    const role = applicationRole(application)
    return {
        title: role ? `${name}: ${role}` : name,
        description: t('meta.description'),
    }
}

/**
 * No loading.tsx on purpose: a streamed shell would commit status 200 before
 * notFound() could answer 404. (The list's loading.tsx sits in the (list)
 * route group so it does not wrap this route.)
 */
export default async function ApplicationPage({ params }: PageProps<'/applications/[id]'>) {
    const { id } = await params
    if (!mayEnter(await requestAccess())) return null
    const application = await loadApplication(id)
    // Seed the client cache with what the server already has: no second fetch.
    const queryClient = getServerQueryClient()
    queryClient.setQueryData(applicationKeys.detail(id), application)
    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <ApplicationView id={id} />
        </HydrationBoundary>
    )
}
