'use client'

import { useMutation } from '@tanstack/react-query'
import { MailIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { applicationMutations } from '@/lib/api/applications'
import { browserApi } from '@/lib/api/browser'
import { type ApplicationDetail, type MaterialsContent } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { apiErrorMessage } from './api-error-message'
import { CopyButton } from './copy-button'
import {
    applyEmail,
    firstTab,
    type MaterialsView,
    MESSAGE_LIMITS,
    MESSAGE_TABS,
    type MessageTab,
    mailtoOf,
    materialsView,
    whyMeText,
} from './materials-view'

type Props = {
    application: Pick<ApplicationDetail, 'id' | 'vacancy' | 'cv' | 'materials'>
}

/**
 * The texts for applying by hand, one tab per channel, each copied in one
 * click. While a version is written the page polls (applicationQueries.detail).
 */
export function ApplicationMessages({ application }: Props) {
    const t = useTranslations('applications.messages')
    const generate = useMutation(applicationMutations.generateMaterials(browserApi))
    const view = materialsView(application.materials, application.cv, Boolean(application.vacancy))
    const channels = application.vacancy?.parsed?.applyChannels ?? []
    const start = () => {
        if (generate.isPending) return
        generate.mutate(application.id, {
            onSuccess: () => toast.success(t('started')),
            onError: error => toast.error(apiErrorMessage(error, t('startFailed'))),
        })
    }
    const canStart = view.kind === 'none' || view.kind === 'ready' || view.kind === 'failed'
    const content = 'content' in view ? view.content : null

    return (
        <section
            aria-labelledby="application-messages-title"
            className="grid min-w-0 gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                    id="application-messages-title"
                    className="text-xl font-semibold"
                >
                    {t('title')}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                    {view.kind === 'ready' && view.version !== null && (
                        <span className="text-xs text-muted-foreground">
                            {t('version', {
                                version: view.version,
                            })}
                        </span>
                    )}
                    {canStart && view.kind !== 'none' && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-busy={generate.isPending || undefined}
                            aria-disabled={generate.isPending || undefined}
                            onClick={start}
                        >
                            <RefreshCwIcon
                                aria-hidden="true"
                                className={cn(generate.isPending && 'animate-spin motion-reduce:animate-none')}
                            />
                            {generate.isPending ? t('starting') : view.kind === 'failed' ? t('retry') : t('regenerate')}
                        </Button>
                    )}
                </div>
            </div>
            <MaterialsState
                view={view}
                onStart={start}
                starting={generate.isPending}
            />
            {content && (
                <MessageTabs
                    content={content}
                    initial={firstTab(channels)}
                    email={applyEmail(channels)}
                />
            )}
            {!content && view.kind === 'generating' && <MessagesSkeleton />}
        </section>
    )
}

function MaterialsState({ view, onStart, starting }: { view: MaterialsView; onStart: () => void; starting: boolean }) {
    const t = useTranslations('applications.messages')
    switch (view.kind) {
        case 'noVacancy':
        case 'waitingCv':
            return <p className="text-muted-foreground">{t(view.kind)}</p>
        case 'none':
            return (
                <div className="grid justify-items-start gap-3">
                    <p className="text-muted-foreground">{t('none')}</p>
                    <Button
                        type="button"
                        aria-busy={starting || undefined}
                        aria-disabled={starting || undefined}
                        onClick={onStart}
                    >
                        {starting ? t('starting') : t('generate')}
                    </Button>
                </div>
            )
        case 'generating':
            return (
                <p
                    role="status"
                    className="text-muted-foreground"
                >
                    {view.content ? t('generatingNewer') : t('generating')}
                </p>
            )
        case 'failed':
            return (
                <p
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
                >
                    {t(`problem.${view.problem}`)}
                </p>
            )
        case 'ready':
            return null
    }
}

/** Placeholders the size of a message, so the page does not jump when the texts arrive. */
function MessagesSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="grid gap-3"
        >
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-40 w-full" />
        </div>
    )
}

function MessageTabs({
    content,
    initial,
    email,
}: {
    content: MaterialsContent
    initial: MessageTab
    email: string | null
}) {
    const t = useTranslations('applications.messages')
    const id = useId()
    const [tab, setTab] = useState<MessageTab>(initial)
    const tabId = (value: MessageTab) => `${id}-tab-${value}`
    const panelId = `${id}-panel`
    // Automatic activation (WAI-ARIA tabs): the arrows, Home and End move and select.
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const index = MESSAGE_TABS.indexOf(tab)
        const last = MESSAGE_TABS.length - 1
        const next =
            event.key === 'ArrowRight'
                ? index === last
                    ? 0
                    : index + 1
                : event.key === 'ArrowLeft'
                  ? index === 0
                      ? last
                      : index - 1
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? last
                      : null
        const value = next === null ? undefined : MESSAGE_TABS[next]
        if (!value) return
        event.preventDefault()
        setTab(value)
        document.getElementById(tabId(value))?.focus()
    }
    return (
        <div className="grid min-w-0 gap-3">
            {/* Scrolls sideways on a narrow screen instead of squeezing the labels. */}
            <div className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1">
                <div
                    role="tablist"
                    aria-label={t('tabs')}
                    className="inline-flex w-max items-center gap-0.5 rounded-lg bg-muted p-[3px]"
                >
                    {MESSAGE_TABS.map(value => {
                        const selected = value === tab
                        return (
                            <button
                                key={value}
                                id={tabId(value)}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={selected ? panelId : undefined}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => setTab(value)}
                                onKeyDown={onKeyDown}
                                className={cn(
                                    'h-8 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                                    selected
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-foreground/80 hover:bg-background/60 hover:text-foreground',
                                )}
                            >
                                {t(value)}
                            </button>
                        )
                    })}
                </div>
            </div>
            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={tabId(tab)}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a tab panel is focusable (WAI-ARIA tabs pattern).
                tabIndex={0}
                className="grid min-w-0 gap-4 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
                <TabPanel
                    tab={tab}
                    content={content}
                    email={email}
                />
            </div>
        </div>
    )
}

function TabPanel({ tab, content, email }: { tab: MessageTab; content: MaterialsContent; email: string | null }) {
    const t = useTranslations('applications.messages')
    switch (tab) {
        case 'email':
            return (
                <>
                    <Message
                        label={t('subject')}
                        text={content.emailSubject}
                        max={MESSAGE_LIMITS.emailSubject}
                        single
                    />
                    <Message
                        label={t('body')}
                        text={content.emailBody}
                    />
                    {email && (
                        <div>
                            <Button
                                asChild
                                variant="outline"
                                size="sm"
                            >
                                <a href={mailtoOf(email, content.emailSubject, content.emailBody)}>
                                    <MailIcon aria-hidden="true" />
                                    {t('writeEmail')}
                                </a>
                            </Button>
                        </div>
                    )}
                </>
            )
        case 'telegram':
            return (
                <Message
                    label={t('telegram')}
                    text={content.telegramMessage}
                    max={MESSAGE_LIMITS.telegramMessage}
                />
            )
        case 'linkedin':
            return (
                <Message
                    label={t('linkedin')}
                    text={content.linkedinNote}
                    max={MESSAGE_LIMITS.linkedinNote}
                />
            )
        case 'coverLetter':
            return (
                <Message
                    label={t('coverLetter')}
                    text={content.coverLetter}
                />
            )
        case 'whyMe':
            return (
                <Message
                    label={t('whyMe')}
                    text={whyMeText(content.whyMe)}
                >
                    <ul className="grid list-disc gap-1 pl-5">
                        {content.whyMe
                            .filter(point => point.trim())
                            .map((point, index) => (
                                <li
                                    // The model may repeat a point.
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a static list per version
                                    key={index}
                                >
                                    {point}
                                </li>
                            ))}
                    </ul>
                </Message>
            )
    }
}

/** One text with its label, a Copy button and, where a channel limits it, its length. */
function Message({
    label,
    text,
    max,
    single = false,
    children,
}: {
    label: string
    text: string
    max?: number
    single?: boolean
    children?: ReactNode
}) {
    const t = useTranslations('applications.messages')
    const over = max !== undefined && text.length > max
    return (
        <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{label}</h3>
                <div className="flex items-center gap-3">
                    {max !== undefined && (
                        <span
                            className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}
                            title={t('lengthLabel', {
                                count: text.length,
                                max,
                            })}
                        >
                            <span aria-hidden="true">
                                {t('length', {
                                    count: text.length,
                                    max,
                                })}
                            </span>
                            <span className="sr-only">
                                {t('lengthLabel', {
                                    count: text.length,
                                    max,
                                })}
                            </span>
                        </span>
                    )}
                    <CopyButton
                        text={text}
                        name={label}
                    />
                </div>
            </div>
            <div
                className={cn(
                    'rounded-lg border border-border bg-muted/40 p-3 break-words',
                    single ? 'font-medium' : 'whitespace-pre-wrap',
                )}
            >
                {children ?? text}
            </div>
        </div>
    )
}
