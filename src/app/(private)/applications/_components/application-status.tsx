'use client'

import { useMutation } from '@tanstack/react-query'
import { SendIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { applicationMutations } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { type ApplicationStatus } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { apiErrorMessage } from './api-error-message'

/** The order a person goes through: new → sent → interview → offer, or rejected on the way. */
export const STATUSES: ApplicationStatus[] = [
    'new',
    'sent',
    'interview',
    'offer',
    'rejected',
]

/** Sets the status (shown at once, put back on failure) and says how it went in a toast. */
export function useStatusChange() {
    const t = useTranslations('applications')
    const options = applicationMutations.updateStatus(browserApi)
    // Toasts in the mutation's own callbacks, not mutate()'s: the button that started it
    // may be gone by then (a row leaves its filter, "Mark as sent" leaves once sent).
    const update = useMutation({
        ...options,
        onSuccess: (_row, { status }) => {
            toast.success(
                status === 'sent'
                    ? t('workspace.markedSent')
                    : t('workspace.statusChanged', {
                          status: t(`status.${status}`),
                      }),
            )
        },
        onError: (error, change, snapshot, context) => {
            options.onError?.(error, change, snapshot, context)
            toast.error(apiErrorMessage(error, t('workspace.statusFailed')))
        },
    })
    const change = (id: string, status: ApplicationStatus) =>
        update.mutate({
            id,
            status,
        })
    return {
        change,
        pending: update.isPending,
    }
}

/** "Mark as sent": the one step after applying by hand. */
export function MarkSentButton({
    applicationId,
    size = 'default',
}: {
    applicationId: string
    size?: 'default' | 'sm' | 'lg'
}) {
    const t = useTranslations('applications.workspace')
    const { change, pending } = useStatusChange()
    return (
        <Button
            type="button"
            size={size}
            aria-disabled={pending || undefined}
            onClick={() => {
                if (!pending) change(applicationId, 'sent')
            }}
        >
            <SendIcon aria-hidden="true" />
            {t('markSent')}
        </Button>
    )
}

/** The status of an application, set by hand: one pressed button of five. */
export function StatusControl({ applicationId, status }: { applicationId: string; status: ApplicationStatus }) {
    const t = useTranslations('applications')
    const { change, pending } = useStatusChange()
    return (
        <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t('workspace.status')}</legend>
            <div className="flex flex-wrap gap-1.5">
                {STATUSES.map(value => {
                    const current = value === status
                    return (
                        <Button
                            key={value}
                            type="button"
                            size="sm"
                            variant={current ? 'default' : 'outline'}
                            aria-pressed={current}
                            aria-disabled={pending || undefined}
                            className={cn(current && 'pointer-events-none')}
                            onClick={() => {
                                if (!current && !pending) change(applicationId, value)
                            }}
                        >
                            {t(`status.${value}`)}
                        </Button>
                    )
                })}
            </div>
        </fieldset>
    )
}
