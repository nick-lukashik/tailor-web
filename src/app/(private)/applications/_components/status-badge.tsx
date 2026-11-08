'use client'

import { useTranslations } from 'next-intl'
import { type ApplicationStatus } from '@/lib/api/types'

export function StatusBadge({ status }: { status: ApplicationStatus }) {
    const t = useTranslations('applications.status')
    return (
        <span className="inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium">
            {t(status)}
        </span>
    )
}
