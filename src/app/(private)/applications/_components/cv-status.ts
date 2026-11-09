import { type ApplicationCv, type ApplicationDetail, type CvStatus } from '@/lib/api/types'
import { httpUrl } from './vacancy-format'

/** Why a CV version failed, as the page says it. */
export type CvProblem = 'notConfigured' | 'model' | 'noProfile' | 'doesNotFit' | 'failed'

/** What the CV block shows. `url` is the newest ready version: it stays while a newer one is made or fails. */
export type CvView =
    | {
          kind: 'noVacancy'
      }
    | {
          kind: 'waiting'
      }
    | {
          kind: 'canGenerate'
      }
    | {
          kind: 'generating'
          url: string | null
      }
    | {
          kind: 'ready'
          url: string | null
          version: number | null
          pages: number | null
          model: string | null
      }
    | {
          kind: 'failed'
          url: string | null
          problem: CvProblem
      }

/** The error code of a failed version (tailor-api `cvs.error`) in plain words where it is obvious. */
export function cvProblem(error: string | null | undefined): CvProblem {
    const code = error?.trim() ?? ''
    if (code === 'storage_not_configured' || code === 'tex_not_configured') return 'notConfigured'
    if (code.startsWith('llm_')) return 'model'
    if (code === 'no_profile') return 'noProfile'
    if (code === 'cv_does_not_fit' || code === 'cv_overfull') return 'doesNotFit'
    return 'failed'
}

/**
 * The CV of an application as its page shows it. Before the first version a
 * CV is made once the vacancy is read (tailor-api queues it after the parse);
 * a parsed vacancy without one (read before CVs existed) can ask for it.
 */
export function cvView(
    cv: ApplicationCv,
    vacancy: Pick<NonNullable<ApplicationDetail['vacancy']>, 'parseStatus'> | null,
): CvView {
    const url = httpUrl(cv.url)
    switch (cv.status) {
        case 'none':
            if (!vacancy)
                return {
                    kind: 'noVacancy',
                }
            return {
                kind: vacancy.parseStatus === 'parsed' ? 'canGenerate' : 'waiting',
            }
        case 'queued':
        case 'generating':
            return {
                kind: 'generating',
                url,
            }
        case 'ready':
            return {
                kind: 'ready',
                url,
                version: cv.version ?? null,
                pages: cv.pages ?? null,
                model: cv.model?.trim() || null,
            }
        case 'failed':
            return {
                kind: 'failed',
                url,
                problem: cvProblem(cv.error),
            }
    }
}

/** The small CV state of a list row; nothing before the first version. */
export function cvBadge(status: CvStatus): 'ready' | 'generating' | 'failed' | null {
    if (status === 'queued' || status === 'generating') return 'generating'
    if (status === 'ready' || status === 'failed') return status
    return null
}
