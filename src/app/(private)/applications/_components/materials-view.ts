import {
    type ApplicationCv,
    type ApplicationMaterials,
    type ApplyChannel,
    type MaterialsContent,
} from '@/lib/api/types'
import { applyChannelLink, httpUrl } from './vacancy-format'

/** tailor-api's limits (src/materials/materials.ts): the texts are clipped to them. */
export const MESSAGE_LIMITS = {
    emailSubject: 150,
    telegramMessage: 600,
    linkedinNote: 300,
} as const

export type MessageTab = 'email' | 'telegram' | 'linkedin' | 'coverLetter' | 'whyMe'
export const MESSAGE_TABS: MessageTab[] = [
    'email',
    'telegram',
    'linkedin',
    'coverLetter',
    'whyMe',
]

export type MaterialsProblem = 'noProfile' | 'model' | 'failed'

/** What the Messages block shows. `content` is the newest ready version: it stays while a newer one is written or fails. */
export type MaterialsView =
    | {
          kind: 'noVacancy' | 'waitingCv' | 'none'
      }
    | {
          kind: 'generating'
          content: MaterialsContent | null
      }
    | {
          kind: 'ready'
          content: MaterialsContent
          version: number | null
      }
    | {
          kind: 'failed'
          content: MaterialsContent | null
          problem: MaterialsProblem
      }

/** The error code of a failed version (tailor-api `materials.error`) in plain words where it is obvious. */
export function materialsProblem(error: string | null | undefined): MaterialsProblem {
    const code = error?.trim() ?? ''
    if (code === 'no_profile') return 'noProfile'
    if (code.startsWith('llm_')) return 'model'
    return 'failed'
}

/**
 * The messages of an application. They are written from a ready CV (tailor-api
 * queues them once one is ready); before that there is nothing to ask for.
 */
export function materialsView(
    materials: ApplicationMaterials,
    cv: Pick<ApplicationCv, 'url'>,
    hasVacancy: boolean,
): MaterialsView {
    const content = materials.content ?? null
    switch (materials.status) {
        case 'none':
            if (!hasVacancy)
                return {
                    kind: 'noVacancy',
                }
            return {
                kind: httpUrl(cv.url) ? 'none' : 'waitingCv',
            }
        case 'queued':
        case 'generating':
            return {
                kind: 'generating',
                content,
            }
        case 'ready':
            return content
                ? {
                      kind: 'ready',
                      content,
                      version: materials.version ?? null,
                  }
                : {
                      kind: 'failed',
                      content: null,
                      problem: 'failed',
                  }
        case 'failed':
            return {
                kind: 'failed',
                content,
                problem: materialsProblem(materials.error),
            }
    }
}

/** The tab to open first: the channel the vacancy asks for (a form or a link wants the cover letter). */
export function firstTab(channels: ApplyChannel[]): MessageTab {
    for (const channel of channels) {
        if (channel.kind === 'email' && applyChannelLink(channel).href) return 'email'
        if (channel.kind === 'telegram') return 'telegram'
        if (channel.kind === 'form' || channel.kind === 'link') return 'coverLetter'
    }
    return 'email'
}

/** The first e-mail address the vacancy names, if any. */
export function applyEmail(channels: ApplyChannel[]): string | null {
    for (const channel of channels) {
        const { href } = applyChannelLink(channel)
        if (href?.startsWith('mailto:')) return href.slice('mailto:'.length)
    }
    return null
}

/** A mailto: link with the subject and the body filled in. */
export function mailtoOf(address: string, subject: string, body: string): string {
    const query = new URLSearchParams({
        subject,
        body,
    })
        .toString()
        // mailto: wants %20, not the + of form encoding.
        .replaceAll('+', '%20')
    return `mailto:${address}?${query}`
}

/** "Why me" as plain lines to paste. */
export function whyMeText(points: string[]): string {
    return points
        .map(point => point.trim())
        .filter(Boolean)
        .map(point => `- ${point}`)
        .join('\n')
}
