'use client'

import { useTranslations } from 'next-intl'
import { type ParseStatus } from '@/lib/api/types'

/** The vacancy's parsing while it matters: being processed or unreadable; nothing once parsed. */
export function ParseBadge({ status }: { status: ParseStatus }) {
    const t = useTranslations('applications.parse')
    if (status !== 'pending' && status !== 'failed') return null
    return (
        <span
            className={
                status === 'failed'
                    ? 'inline-flex w-fit items-center rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium text-destructive'
                    : 'inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
        >
            {t(status)}
        </span>
    )
}
