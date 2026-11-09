'use client'

import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { applicationMutations } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { isApiError } from '@/lib/api/errors'
import { type ApplicationCv, type ApplicationVacancy } from '@/lib/api/types'
import { cvView } from './cv-status'

type Props = {
    applicationId: string
    cv: ApplicationCv
    vacancy: Pick<ApplicationVacancy, 'parseStatus'> | null
}

/**
 * The CV of this application: its state, its details and "Generate again"
 * (the link to open it is in the page's header). While a version is queued or
 * generating the page polls (applicationQueries.detail); a new one can be
 * asked for once the vacancy is read. The request lives here, not in its
 * button, so a 409 stays on screen after the refetch it causes.
 */
export function ApplicationCvBlock({ applicationId, cv, vacancy }: Props) {
    const t = useTranslations('applications.cv')
    const generate = useMutation(applicationMutations.generateCv(browserApi))
    const view = cvView(cv, vacancy)
    const button = (label: string, variant: 'default' | 'outline' = 'default') => (
        <div>
            <Button
                variant={variant}
                aria-busy={generate.isPending || undefined}
                aria-disabled={generate.isPending || undefined}
                onClick={() => {
                    if (!generate.isPending) generate.mutate(applicationId)
                }}
            >
                {generate.isPending && (
                    <Loader2Icon
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                    />
                )}
                {generate.isPending ? t('starting') : label}
            </Button>
        </div>
    )
    const details =
        view.kind === 'ready'
            ? [
                  view.version !== null
                      && t('version', {
                          version: view.version,
                      }),
                  view.pages !== null
                      && t('pages', {
                          pages: view.pages,
                      }),
                  view.model
                      && t('model', {
                          model: view.model,
                      }),
              ].filter(Boolean)
            : []
    return (
        <section
            aria-labelledby="application-cv-title"
            className="grid justify-items-start gap-3"
        >
            <h2
                id="application-cv-title"
                className="text-xl font-semibold"
            >
                {t('title')}
            </h2>
            {view.kind === 'noVacancy' && <p className="text-muted-foreground">{t('noVacancy')}</p>}
            {view.kind === 'waiting' && <p className="text-muted-foreground">{t('waiting')}</p>}
            {view.kind === 'canGenerate' && button(t('generate'))}
            {view.kind === 'generating' && (
                <>
                    <p
                        role="status"
                        className="flex items-center gap-2 text-muted-foreground"
                    >
                        <Loader2Icon
                            aria-hidden="true"
                            className="size-4 animate-spin motion-reduce:animate-none"
                        />
                        {t('generating')}
                    </p>
                    <Skeleton className="h-4 w-48" />
                </>
            )}
            {view.kind === 'ready' && (
                <>
                    {details.length > 0 && <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>}
                    {button(t('again'), 'outline')}
                </>
            )}
            {view.kind === 'failed' && (
                <div className="grid justify-items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                    <p>{t(`problem.${view.problem}`)}</p>
                    {button(t('retry'), 'outline')}
                </div>
            )}
            {generate.isError && (
                <p
                    role="alert"
                    className="text-sm text-destructive"
                >
                    {isApiError(generate.error) && generate.error.code === 'CONFLICT'
                        ? generate.error.message
                        : t('startFailed')}
                </p>
            )}
        </section>
    )
}
