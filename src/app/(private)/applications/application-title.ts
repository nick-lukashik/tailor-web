import { type Application, type ParsedVacancy } from '@/lib/api/types'

/** `jobs.example.com` from a vacancy link, without `www.`; null for no link or a broken one. */
export function vacancyHost(url: string | null): string | null {
    if (!url) return null
    try {
        return new URL(url).hostname.replace(/^www\./, '') || null
    } catch {
        return null
    }
}

/** A list row, or an application with its vacancy (whose parsed company and title fill the gaps). */
type Named = Pick<Application, 'company' | 'role' | 'vacancyUrl'> & {
    vacancy?: {
        url: string | null
        parsed: Pick<ParsedVacancy, 'company' | 'title'> | null
    } | null
}

/**
 * What names an application: the company, else the one read from the vacancy,
 * else the vacancy link's host (a pasted vacancy is not parsed yet), else null
 * for the caller's "Untitled vacancy".
 */
export function applicationTitle(application: Omit<Named, 'role'>): string | null {
    return (
        application.company.trim()
        || application.vacancy?.parsed?.company?.trim()
        || vacancyHost(application.vacancy?.url ?? application.vacancyUrl)
    )
}

/** The role: the application's own, else the vacancy's title; null for none. */
export function applicationRole(application: Named): string | null {
    return application.role.trim() || application.vacancy?.parsed?.title?.trim() || null
}
