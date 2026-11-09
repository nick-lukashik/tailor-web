'use client'

import { useTranslations } from 'next-intl'
import { type CvStatus } from '@/lib/api/types'
import { cvBadge } from './cv-status'

/** The CV state of a list row: ready, being made or failed; nothing before the first version. */
export function CvBadge({ status }: { status: CvStatus }) {
    const t = useTranslations('applications.cv.badge')
    const badge = cvBadge(status)
    if (!badge) return null
    return (
        <span
            className={
                badge === 'failed'
                    ? 'inline-flex w-fit items-center rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium text-destructive'
                    : 'inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
        >
            {t(badge)}
        </span>
    )
}
