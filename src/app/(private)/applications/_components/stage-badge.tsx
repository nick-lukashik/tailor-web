'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { type Stage } from './stage'

const STYLE: Record<Stage, string> = {
    reading: 'border-border text-muted-foreground',
    generating: 'border-border text-muted-foreground',
    ready: 'border-primary bg-primary text-primary-foreground',
    sent: 'border-border bg-secondary text-secondary-foreground',
    interview: 'border-foreground/40 bg-secondary text-secondary-foreground',
    offer: 'border-foreground/60 bg-secondary font-semibold text-secondary-foreground',
    rejected: 'border-border text-muted-foreground',
    failed: 'border-destructive/40 text-destructive',
    incomplete: 'border-dashed border-border text-muted-foreground',
}

/** Where an application is: one badge for the list and the page. */
export function StageBadge({ stage }: { stage: Stage }) {
    const t = useTranslations('applications.stage')
    return (
        <span
            className={cn(
                'inline-flex w-fit shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                STYLE[stage],
            )}
        >
            {t(stage)}
        </span>
    )
}
