import { mutationOptions } from '@tanstack/react-query'
import { applicationKeys } from './applications'
import { type ApiClient } from './client'
import { type VacancyIntakeInput, type VacancyIntakeResult } from './types'

/** Items per intake request (tailor-api `INTAKE_MAX_ITEMS`). */
export const INTAKE_MAX_ITEMS = 200

/** Pasted vacancies into the person's pool (tailor-api). The client is passed in: server or browser. */
export const vacanciesApi = {
    intake: (api: ApiClient, input: VacancyIntakeInput) =>
        api.request<VacancyIntakeResult>('/api/v1/vacancies/intake', {
            method: 'POST',
            body: input,
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
}
