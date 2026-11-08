import 'server-only'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { applicationsApi } from '@/lib/api/applications'
import { isApiError } from '@/lib/api/errors'
import { serverApi } from '@/lib/api/server'

/**
 * One fetch per request for generateMetadata and the page (React cache).
 * The API's 404 becomes the app's not-found page; other errors go to error.tsx.
 */
export const loadApplication = cache(async (id: string) => {
    try {
        return await applicationsApi.get(await serverApi(), id)
    } catch (error) {
        if (isApiError(error) && error.code === 'NOT_FOUND') notFound()
        throw error
    }
})
