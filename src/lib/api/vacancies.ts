import { mutationOptions } from '@tanstack/react-query'
import { applicationKeys } from './applications'
import { type ApiClient } from './client'
import {
    type VacancyFetchQueued,
    type VacancyIntakeInput,
    type VacancyIntakeResult,
    type VacancyParseQueued,
} from './types'

/** Items per intake request (tailor-api `INTAKE_MAX_ITEMS`). */
export const INTAKE_MAX_ITEMS = 200

/** Pasted vacancies into the person's pool (tailor-api). The client is passed in: server or browser. */
export const vacanciesApi = {
    intake: (api: ApiClient, input: VacancyIntakeInput) =>
        api.request<VacancyIntakeResult>('/api/v1/vacancies/intake', {
            method: 'POST',
            body: input,
        }),
    /** Reads the vacancy again in the background (202): `pending` until it is done. */
    reparse: (api: ApiClient, vacancyId: string) =>
        api.request<VacancyParseQueued>(`/api/v1/vacancies/${encodeURIComponent(vacancyId)}/parse`, {
            method: 'POST',
        }),
    /** Reads the vacancy's link again in the background (202), its apply form too; 409 without a link. */
    refetch: (api: ApiClient, vacancyId: string) =>
        api.request<VacancyFetchQueued>(`/api/v1/vacancies/${encodeURIComponent(vacancyId)}/fetch`, {
            method: 'POST',
        }),
}

export const vacancyKeys = {
    all: [
        'vacancies',
    ] as const,
    intake: () =>
        [
            ...vacancyKeys.all,
            'intake',
        ] as const,
    reparse: () =>
        [
            ...vacancyKeys.all,
            'reparse',
        ] as const,
    refetch: () =>
        [
            ...vacancyKeys.all,
            'refetch',
        ] as const,
}

export const vacancyMutations = {
    /** Every new or found vacancy is an application in the pool: the lists refetch. */
    intake: (api: ApiClient) =>
        mutationOptions({
            mutationKey: vacancyKeys.intake(),
            mutationFn: (input: VacancyIntakeInput) => vacanciesApi.intake(api, input),
            onSuccess: (_result, _input, _onMutateResult, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.lists(),
                }),
        }),
    /** The vacancy is `pending` again: the application pages and lists refetch (and poll). */
    reparse: (api: ApiClient) =>
        mutationOptions({
            mutationKey: vacancyKeys.reparse(),
            mutationFn: (vacancyId: string) => vacanciesApi.reparse(api, vacancyId),
            onSuccess: (_result, _vacancyId, _onMutateResult, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.all,
                }),
        }),
    /** The link is `pending` again: as for a reparse, everything about applications refetches (and polls). */
    refetch: (api: ApiClient) =>
        mutationOptions({
            mutationKey: vacancyKeys.refetch(),
            mutationFn: (vacancyId: string) => vacanciesApi.refetch(api, vacancyId),
            onSuccess: (_result, _vacancyId, _onMutateResult, context) =>
                context.client.invalidateQueries({
                    queryKey: applicationKeys.all,
                }),
        }),
}
