import { type ApplicationVacancy, type ApplyChannel, type VacancySalary } from '@/lib/api/types'

/** A salary as the page says it: the amount (or range) in the reader's locale, its bound and period. */
export type SalaryText = {
    /** `range` and `exact` read as the amount alone; `from` / `upTo` need a word around it. */
    bound: 'range' | 'exact' | 'from' | 'upTo'
    amount: string
    period: VacancySalary['period']
}

/** Formats a number like next-intl's `format.number` (the page passes it; tests pass Intl). */
export type FormatNumber = (
    value: number,
    options: {
        style?: 'currency'
        currency?: string
        minimumFractionDigits: number
        maximumFractionDigits: number
    },
) => string

/** A three-letter code is formatted as a currency; anything else the model wrote follows the number. */
function amountOf(formatNumber: FormatNumber, currency: string | null) {
    const code = currency?.trim().toUpperCase() ?? ''
    const digits = {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }
    if (/^[A-Z]{3}$/.test(code))
        return (value: number) =>
            formatNumber(value, {
                style: 'currency',
                currency: code,
                ...digits,
            })
    const other = currency?.trim()
    return (value: number) => formatNumber(value, digits) + (other ? ` ${other}` : '')
}

/** The salary of a parsed vacancy, or null when it names no amount. */
export function salaryText(salary: VacancySalary | null, formatNumber: FormatNumber): SalaryText | null {
    if (!salary) return null
    const { min, max, period } = salary
    const amount = amountOf(formatNumber, salary.currency)
    if (min !== null && max !== null) {
        if (min === max)
            return {
                bound: 'exact',
                amount: amount(min),
                period,
            }
        return {
            bound: 'range',
            amount: `${amount(Math.min(min, max))}–${amount(Math.max(min, max))}`,
            period,
        }
    }
    if (min !== null)
        return {
            bound: 'from',
            amount: amount(min),
            period,
        }
    if (max !== null)
        return {
            bound: 'upTo',
            amount: amount(max),
            period,
        }
    return null
}

/** An http(s) URL as written, else null: nothing else (javascript:, data:) becomes a link. */
export function httpUrl(value: string | null | undefined): string | null {
    const text = value?.trim()
    if (!text) return null
    try {
        const url = new URL(text)
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
    } catch {
        return null
    }
}

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/
const TELEGRAM_HANDLE = /^@([A-Za-z][A-Za-z0-9_]{3,31})$/
const BARE_HOST = /^(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i

/** An address with no scheme (`jobs.example.com/apply`) as an https link. */
function linkOf(value: string): string | null {
    return httpUrl(value) ?? (BARE_HOST.test(value) ? httpUrl(`https://${value}`) : null)
}

function emailOf(value: string): string | null {
    const address = value.replace(/^mailto:/i, '')
    return EMAIL.test(address) ? address : null
}

/** How to reach one apply channel: `href` is null when the value is not something to open. */
export function applyChannelLink(channel: ApplyChannel): {
    href: string | null
    label: string
} {
    const value = channel.value.trim()
    const plain = {
        href: null,
        label: value,
    }
    switch (channel.kind) {
        case 'email': {
            const address = emailOf(value)
            return address
                ? {
                      href: `mailto:${address}`,
                      label: address,
                  }
                : plain
        }
        case 'telegram': {
            const handle = TELEGRAM_HANDLE.exec(value)?.[1]
            if (handle)
                return {
                    href: `https://t.me/${handle}`,
                    label: value,
                }
            const url = linkOf(value)
            return url && /^https:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//.test(url)
                ? {
                      href: url,
                      label: value,
                  }
                : plain
        }
        case 'form':
        case 'link':
        case 'other': {
            const url = linkOf(value)
            if (url)
                return {
                    href: url,
                    label: value,
                }
            const address = channel.kind === 'other' ? emailOf(value) : null
            return address
                ? {
                      href: `mailto:${address}`,
                      label: address,
                  }
                : plain
        }
    }
}

/** An ISO 639 code (`en`, `pt-BR`) the page may name, lower-cased language part; null for none or junk. */
export function languageCode(code: string | null): string | null {
    const text = code?.trim()
    if (!text || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(text)) return null
    return text.toLowerCase()
}

/** Why a vacancy could not be read, as the page says it: no text to read, or anything else. */
export function parseProblem(vacancy: Pick<ApplicationVacancy, 'parseError'>): 'noText' | 'failed' {
    return vacancy.parseError === 'no_text' ? 'noText' : 'failed'
}
