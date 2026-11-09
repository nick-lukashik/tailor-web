'use client'

import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { browserApi } from '@/lib/api/browser'
import { type ApplicationVacancy, type ParsedVacancy } from '@/lib/api/types'
import { vacancyMutations } from '@/lib/api/vacancies'
import { cn } from '@/lib/utils'
import { languageCode, parseProblem, salaryText } from './vacancy-format'

/**
 * What was read from the vacancy. While it is `pending` the page polls
 * (applicationQueries.detail); a failed one can be read again.
 */
export function VacancyDetails({ vacancy }: { vacancy: ApplicationVacancy }) {
    const t = useTranslations('applications.vacancy')
    return (
        <section
            aria-labelledby="vacancy-title"
            className="grid gap-4"
        >
            <h2
                id="vacancy-title"
                className="text-xl font-semibold"
            >
                {t('title')}
            </h2>
            {vacancy.parseStatus === 'pending' && (
                <p
                    role="status"
                    className="flex items-center gap-2 text-muted-foreground"
                >
                    <Loader2Icon
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none"
                    />
                    {t('pending')}
                </p>
            )}
            {vacancy.parseStatus === 'pending' && (
                <div
                    aria-hidden="true"
                    className="grid gap-2"
                >
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
            )}
            {vacancy.parseStatus === 'failed' && <ParseFailed vacancy={vacancy} />}
            {vacancy.parseStatus === 'parsed' && vacancy.parsed && <Parsed parsed={vacancy.parsed} />}
        </section>
    )
}

function ParseFailed({ vacancy }: { vacancy: ApplicationVacancy }) {
    const t = useTranslations('applications.vacancy')
    const reparse = useMutation(vacancyMutations.reparse(browserApi))
    return (
        <div className="grid justify-items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p>{t(parseProblem(vacancy))}</p>
            <Button
                variant="outline"
                aria-busy={reparse.isPending || undefined}
                aria-disabled={reparse.isPending || undefined}
                onClick={() => {
                    if (!reparse.isPending) reparse.mutate(vacancy.id)
                }}
            >
                {reparse.isPending && (
                    <Loader2Icon
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                    />
                )}
                {reparse.isPending ? t('reading') : t('readAgain')}
            </Button>
            {reparse.isError && (
                <p
                    role="alert"
                    className="text-sm text-destructive"
                >
                    {t('readAgainFailed')}
                </p>
            )}
        </div>
    )
}

function Parsed({ parsed }: { parsed: ParsedVacancy }) {
    const t = useTranslations('applications.vacancy')
    const required = parsed.skills.some(skill => skill.required)
    const optional = parsed.skills.some(skill => !skill.required)
    return (
        <>
            {parsed.summary.trim() && <p className="whitespace-pre-wrap">{parsed.summary}</p>}
            <Facts parsed={parsed} />
            {parsed.skills.length > 0 && (
                <Part title={t('skills')}>
                    <ul className="flex flex-wrap gap-2">
                        {parsed.skills.map((skill, index) => (
                            <li
                                // The model may name a skill twice.
                                // biome-ignore lint/suspicious/noArrayIndexKey: a static list per answer
                                key={index}
                                className={cn(
                                    'rounded-md border px-2 py-0.5 text-sm',
                                    skill.required
                                        ? 'border-foreground/40 bg-secondary font-semibold'
                                        : 'border-border text-muted-foreground',
                                )}
                            >
                                {skill.name}
                                {skill.required && <span className="sr-only">, {t('requiredSkill')}</span>}
                            </li>
                        ))}
                    </ul>
                    {required && optional && <p className="text-xs text-muted-foreground">{t('requiredHint')}</p>}
                </Part>
            )}
            <TextList
                title={t('requirements')}
                items={parsed.requirements}
            />
            <TextList
                title={t('responsibilities')}
                items={parsed.responsibilities}
            />
            <TextList
                title={t('niceToHave')}
                items={parsed.niceToHave}
            />
        </>
    )
}

/** Remote, location, regions, level, employment, salary, language: whichever the vacancy states. */
function Facts({ parsed }: { parsed: ParsedVacancy }) {
    const t = useTranslations('applications.vacancy')
    const format = useFormatter()
    const salary = salaryText(parsed.salary, (value, options) => format.number(value, options))
    const salaryLabel =
        salary
        && t(`salaryBound.${salary.bound}`, {
            amount: salary.amount,
        })
    const language = languageCode(parsed.language)
    const facts: [
        string,
        string | null,
    ][] = [
        [
            t('format'),
            parsed.remote === 'unknown' ? null : t(`remote.${parsed.remote}`),
        ],
        [
            t('location'),
            parsed.location?.trim() || null,
        ],
        [
            t('regions'),
            parsed.regions.length > 0 ? format.list(parsed.regions) : null,
        ],
        [
            t('seniority'),
            parsed.seniority?.trim() || null,
        ],
        [
            t('employment'),
            parsed.employmentType ? t(`employmentType.${parsed.employmentType}`) : null,
        ],
        [
            t('salary'),
            salaryLabel && salary.period
                ? t('salaryPeriod', {
                      amount: salaryLabel,
                      period: salary.period,
                  })
                : salaryLabel,
        ],
        [
            t('language'),
            language
                && format.displayName(language, {
                    type: 'language',
                }),
        ],
    ]
    const shown = facts.filter(
        (
            fact,
        ): fact is [
            string,
            string,
        ] => Boolean(fact[1]),
    )
    if (shown.length === 0) return null
    return (
        <dl
            aria-label={t('facts')}
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
        >
            {shown.map(([label, value]) => (
                <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                </div>
            ))}
        </dl>
    )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="grid gap-2">
            <h3 className="font-semibold">{title}</h3>
            {children}
        </div>
    )
}

/** A short list of the vacancy; nothing when it is empty. */
function TextList({ title, items }: { title: string; items: string[] }) {
    const shown = items.filter(item => item.trim())
    if (shown.length === 0) return null
    return (
        <Part title={title}>
            <ul className="grid list-disc gap-1 pl-5">
                {shown.map((item, index) => (
                    <li
                        // The model may repeat a line.
                        // biome-ignore lint/suspicious/noArrayIndexKey: a static list per answer
                        key={index}
                    >
                        {item}
                    </li>
                ))}
            </ul>
        </Part>
    )
}
