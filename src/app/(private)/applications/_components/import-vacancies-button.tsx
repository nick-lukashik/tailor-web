'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUpIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { type ChangeEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { applicationKeys } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { vacanciesApi } from '@/lib/api/vacancies'
import { chunkErrorMessage, chunkItems, IMPORT_FILE_MAX_BYTES, importItems, sendChunks } from './vacancy-import'

/** Validation issues shown in the toast; the rest are counted. */
const SHOWN_ISSUES = 3

/**
 * "Import file": a local JSON file shaped like the intake body, any number of
 * vacancies, checked here and sent in requests of at most 200 items and under
 * the 1 MiB body cap, one after another. One toast sums it up; each failed
 * request gets its own.
 */
export function ImportVacanciesButton() {
    const t = useTranslations('applications.intake')
    const format = useFormatter()
    const id = useId()
    const client = useQueryClient()
    const [progress, setProgress] = useState<{
        done: number
        total: number
    } | null>(null)

    const run = useMutation({
        mutationFn: async (file: File) => {
            if (file.size > IMPORT_FILE_MAX_BYTES) {
                toast.error(t('importProblem.tooLarge'))
                return
            }
            const checked = importItems(await file.text())
            if ('problem' in checked) {
                const { problem } = checked
                if (problem.kind !== 'items') {
                    toast.error(t(`importProblem.${problem.kind}`))
                    return
                }
                const shown = problem.issues.slice(0, SHOWN_ISSUES).map(issue =>
                    t(`importIssue.${issue.reason}`, {
                        number: issue.item + 1,
                    }),
                )
                const rest = problem.issues.length - shown.length
                toast.error(
                    t('importProblem.items', {
                        count: problem.issues.length,
                        list: format.list(
                            rest > 0
                                ? [
                                      ...shown,
                                      t('importProblem.more', {
                                          count: rest,
                                      }),
                                  ]
                                : shown,
                        ),
                    }),
                )
                return
            }
            const chunks = chunkItems(checked.items)
            setProgress({
                done: 0,
                total: chunks.length,
            })
            const outcome = await sendChunks(
                chunks,
                items =>
                    vacanciesApi.intake(browserApi, {
                        items,
                    }),
                (done, total) =>
                    setProgress({
                        done,
                        total,
                    }),
            )
            for (const failure of outcome.failures) {
                const range = {
                    from: failure.from + 1,
                    to: failure.from + failure.count,
                }
                const reason = chunkErrorMessage(failure.error)
                toast.error(
                    reason
                        ? t('importChunkFailed', {
                              ...range,
                              reason,
                          })
                        : t('importChunkFailedPlain', range),
                )
            }
            if (outcome.failures.length < chunks.length)
                toast.success(
                    t('batchResult', {
                        created: outcome.created,
                        existing: outcome.existing,
                    }),
                )
            await client.invalidateQueries({
                queryKey: applicationKeys.lists(),
            })
        },
        onError: () => toast.error(t('failed')),
        onSettled: () => setProgress(null),
    })

    const pick = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        // The same file may be picked again later.
        event.target.value = ''
        if (file && !run.isPending) run.mutate(file)
    }

    return (
        <>
            <input
                id={`${id}-file`}
                type="file"
                accept=".json,application/json"
                aria-label={t('importFile')}
                className="sr-only"
                tabIndex={-1}
                onChange={pick}
            />
            <Button
                type="button"
                variant="link"
                size="sm"
                aria-busy={run.isPending || undefined}
                aria-disabled={run.isPending || undefined}
                onClick={() => {
                    if (!run.isPending) document.getElementById(`${id}-file`)?.click()
                }}
            >
                <FileUpIcon aria-hidden="true" />
                {progress ? t('importing', progress) : t('import')}
            </Button>
        </>
    )
}
