import { isApiError } from '@/lib/api/errors'
import { type VacancyIntakeInput, type VacancyIntakeResult } from '@/lib/api/types'
import { INTAKE_MAX_ITEMS } from '@/lib/api/vacancies'

/** What the "Add vacancy" form holds: one vacancy (a link, its text or both), or a list of links. */
export type IntakeDraft =
    | {
          mode: 'single'
          url: string
          text: string
      }
    | {
          mode: 'batch'
          links: string
      }
export type IntakeMode = IntakeDraft['mode']

export type IntakeProblem =
    /** Nothing to send. */
    | {
          kind: 'empty'
      }
    /** More links than one request takes. */
    | {
          kind: 'tooMany'
          count: number
      }
    /** tailor-api refused the request (400); `item` is the 0-based index of the vacancy, if any. */
    | {
          kind: 'rejected'
          issues: {
              item: number | null
              message: string
          }[]
      }
    | {
          kind: 'tooLarge' | 'failed'
      }

export type IntakeOutcome =
    | {
          kind: 'added' | 'existing'
      }
    | {
          kind: 'batch'
          created: number
          existing: number
      }

/** The non-empty lines of the batch textarea, trimmed: one link each. */
export function linksOf(links: string): string[] {
    return links
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
}

/** The request for a draft, or what stops it before it is sent. */
export function intakeInput(draft: IntakeDraft):
    | {
          input: VacancyIntakeInput
      }
    | {
          problem: IntakeProblem
      } {
    if (draft.mode === 'batch') {
        const links = linksOf(draft.links)
        if (links.length === 0)
            return {
                problem: {
                    kind: 'empty',
                },
            }
        if (links.length > INTAKE_MAX_ITEMS)
            return {
                problem: {
                    kind: 'tooMany',
                    count: links.length,
                },
            }
        return {
            input: {
                items: links.map(url => ({
                    url,
                })),
            },
        }
    }
    const url = draft.url.trim()
    // The text goes as pasted; blank counts as none (as on the API).
    const text = draft.text.trim() ? draft.text : ''
    if (!url && !text)
        return {
            problem: {
                kind: 'empty',
            },
        }
    return {
        input: {
            items: [
                {
                    ...(url
                        ? {
                              url,
                          }
                        : {}),
                    ...(text
                        ? {
                              text,
                          }
                        : {}),
                },
            ],
        },
    }
}

/** `items.3.url` → 3. */
function itemOf(path: string): number | null {
    const match = /^items\.(\d+)(?:\.|$)/.exec(path)
    return match ? Number(match[1]) : null
}

/** What went wrong with a sent request, from tailor-api's error (or the proxy's). */
export function problemOf(error: unknown): IntakeProblem {
    if (!isApiError(error))
        return {
            kind: 'failed',
        }
    if (error.status === 413)
        return {
            kind: 'tooLarge',
        }
    if (error.code === 'VALIDATION_FAILED')
        return {
            kind: 'rejected',
            issues: error.details.length
                ? error.details.map(issue => ({
                      item: itemOf(issue.path),
                      message: issue.message,
                  }))
                : [
                      {
                          item: null,
                          message: error.message,
                      },
                  ],
        }
    return {
        kind: 'failed',
    }
}

/** The short result shown after a successful request. */
export function outcomeOf(mode: IntakeMode, result: VacancyIntakeResult): IntakeOutcome {
    if (mode === 'batch')
        return {
            kind: 'batch',
            created: result.created,
            existing: result.existing,
        }
    return {
        kind: result.created > 0 ? 'added' : 'existing',
    }
}
