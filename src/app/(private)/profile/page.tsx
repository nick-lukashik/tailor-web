import { type Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isApiError } from '@/lib/api/errors'
import { profileApi } from '@/lib/api/profile'
import { serverApi } from '@/lib/api/server'
import { type Profile } from '@/lib/api/types'
import { mayEnter, requestAccess } from '@/lib/session/access'
import { ProfileEditor } from './_components/profile-editor'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('profileEditor.meta')
    return {
        title: t('title'),
        description: t('description'),
    }
}

/** The stored profile, or null before the first save; undefined when it could not be read. */
async function loadProfile(): Promise<Profile | null | undefined> {
    try {
        return await profileApi.get(await serverApi())
    } catch (error) {
        if (isApiError(error) && error.code === 'NOT_FOUND') return null
        return undefined
    }
}

/**
 * The profile as one JSON document (D-98): no forms per field, no wizard. tailor-api
 * validates the whole document on save and names every bad path.
 */
export default async function ProfilePage() {
    if (!mayEnter(await requestAccess())) return null
    const [t, profile] = await Promise.all([
        getTranslations('profileEditor'),
        loadProfile(),
    ])
    return (
        <div className="grid gap-6">
            <header className="grid gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{t('heading')}</h1>
                <p className="max-w-2xl text-muted-foreground">{t('lead')}</p>
            </header>
            {profile === undefined ? (
                <p role="alert">{t('loadFailed')}</p>
            ) : (
                <ProfileEditor
                    initialVersion={profile?.version ?? null}
                    initialText={profile ? JSON.stringify(profile.document, null, 4) : '{}'}
                />
            )}
        </div>
    )
}
