import { queryOptions } from '@tanstack/react-query'
import { type ApiClient } from './client'
import { type Me, type Profile, type SavedProfile } from './types'

/** The caller and the profile (tailor-api). The client is passed in: server or browser. */
export const profileApi = {
    me: (api: ApiClient, signal?: AbortSignal) =>
        api.request<Me>('/api/v1/me', {
            signal,
        }),
    get: (api: ApiClient, signal?: AbortSignal) =>
        api.request<Profile>('/api/v1/profile', {
            signal,
        }),
    /** The whole document; tailor-api validates it and answers the new version. */
    save: (api: ApiClient, document: unknown) =>
        api.request<SavedProfile>('/api/v1/profile', {
            method: 'PUT',
            body: document,
        }),
}

export const profileKeys = {
    all: [
        'profile',
    ] as const,
}

export const profileQueries = {
    profile: (api: ApiClient) =>
        queryOptions({
            queryKey: profileKeys.all,
            queryFn: ({ signal }) => profileApi.get(api, signal),
        }),
}
