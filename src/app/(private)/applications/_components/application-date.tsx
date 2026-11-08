'use client'

import { useFormatter } from 'next-intl'

const OPTIONS = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
} as const

/** Formats a timestamp in the reader's language (UTC on both sides, see i18n/request.ts). */
export function useApplicationDate() {
    const format = useFormatter()
    return (value: string) => format.dateTime(new Date(value), OPTIONS)
}

export function ApplicationDate({ value }: { value: string }) {
    const formatDate = useApplicationDate()
    return <time dateTime={value}>{formatDate(value)}</time>
}
