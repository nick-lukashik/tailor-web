import { type Application } from '@/lib/api/types'
import { applicationRole, applicationTitle } from '../application-title'

/**
 * Where an application is on the way to being sent. The status the person set
 * wins once it is past `new`; before that the pipeline decides: the vacancy
 * read, the CV and the messages written, then ready to send. `incomplete` is a
 * `new` one where nothing runs and something is missing (no vacancy, no CV
 * asked for yet): it shows only under "All".
 */
export type Stage =
    | 'reading'
    | 'generating'
    | 'ready'
    | 'sent'
    | 'interview'
    | 'offer'
    | 'rejected'
    | 'failed'
    | 'incomplete'

/** The filter chips of the list, in order. */
export const STAGE_FILTERS = [
    'all',
    'reading',
    'generating',
    'ready',
    'sent',
    'interview',
    'offer',
    'rejected',
    'failed',
] as const
export type StageFilter = (typeof STAGE_FILTERS)[number]

export type StageFields = Pick<Application, 'status' | 'parseStatus' | 'cvStatus' | 'materialsStatus'>

const running = (status: string) => status === 'queued' || status === 'generating'

export function applicationStage({ status, parseStatus, cvStatus, materialsStatus }: StageFields): Stage {
    if (status !== 'new') return status
    if (parseStatus === 'pending') return 'reading'
    if (running(cvStatus) || running(materialsStatus)) return 'generating'
    if (parseStatus === 'failed' || cvStatus === 'failed' || materialsStatus === 'failed') return 'failed'
    if (cvStatus === 'ready' && materialsStatus === 'ready') return 'ready'
    return 'incomplete'
}

export function matchesStage(filter: StageFilter, stage: Stage): boolean {
    return filter === 'all' || filter === stage
}

/** How many applications each chip would show. */
export function stageCounts(items: StageFields[]): Record<StageFilter, number> {
    const counts = Object.fromEntries(
        STAGE_FILTERS.map(filter => [
            filter,
            0,
        ]),
    ) as Record<StageFilter, number>
    for (const item of items) {
        const stage = applicationStage(item)
        counts.all += 1
        if (stage !== 'incomplete') counts[stage] += 1
    }
    return counts
}

/** `?stage=` as a filter; anything else is "All". */
export function stageFilterOf(value: string | null | undefined): StageFilter {
    return STAGE_FILTERS.find(filter => filter === value) ?? 'all'
}

/** Lower-case, accents and extra spaces dropped: "  Café " finds "cafe". */
function normalized(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Whether a row's company or role (as the list names them) has every word of the query. */
export function matchesSearch(
    application: Pick<Application, 'company' | 'role' | 'vacancyUrl'>,
    query: string,
): boolean {
    const words = normalized(query).split(' ').filter(Boolean)
    if (words.length === 0) return true
    const haystack = normalized(`${applicationTitle(application) ?? ''} ${applicationRole(application) ?? ''}`)
    return words.every(word => haystack.includes(word))
}

/** The rows a chip and a query show, in the list's order. */
export function filterApplications<T extends Application>(items: T[], filter: StageFilter, query: string): T[] {
    return items.filter(item => matchesStage(filter, applicationStage(item)) && matchesSearch(item, query))
}
