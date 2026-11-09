import { type Application } from '@/lib/api/types'

/** `jobs.example.com` from a vacancy link, without `www.`; null for no link or a broken one. */
export function vacancyHost(url: string | null): string | null {
    if (!url) return null
    try {
        return new URL(url).hostname.replace(/^www\./, '') || null
    } catch {
        return null
    }
}

/**
 * What names an application: the company, else the vacancy link's host (a pasted
 * vacancy is not parsed yet), else null for the caller's "Untitled vacancy".
 */
export function applicationTitle(application: Pick<Application, 'company' | 'vacancyUrl'>): string | null {
    return application.company.trim() || vacancyHost(application.vacancyUrl)
}
