'use client'

import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type ApplicationDetail } from '@/lib/api/types'
import { applicationRole, applicationTitle } from '../application-title'
import { useApplicationDate } from './application-date'
import { MarkSentButton, StatusControl } from './application-status'
import { CopyButton } from './copy-button'
import { applicationStage } from './stage'
import { StageBadge } from './stage-badge'
import { applyChannelLink, httpUrl } from './vacancy-format'

/**
 * The top of the application page: what to open, where to apply and the
 * status. "Mark as sent" is the main action once there is a CV to send.
 */
export function ApplyHeader({ application }: { application: ApplicationDetail }) {
    const t = useTranslations('applications')
    const formatDate = useApplicationDate()
    const { vacancy } = application
    const role = applicationRole(application)
    const vacancyUrl = httpUrl(vacancy?.url ?? application.vacancyUrl)
    const cvUrl = httpUrl(application.cv.url)
    const channels = vacancy?.parsed?.applyChannels ?? []
    const toSend = application.status === 'new' && Boolean(cvUrl)
    return (
        <header className="grid gap-5 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
            <div className="grid gap-2">
                <h1 className="text-2xl font-bold tracking-tight break-words sm:text-3xl">
                    {applicationTitle(application) ?? t('untitled')}
                </h1>
                {role && <p className="text-lg text-muted-foreground">{role}</p>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <StageBadge stage={applicationStage(application)} />
                    <span>
                        {t.rich('detail.createdAt', {
                            date: formatDate(application.createdAt),
                            time: chunks => <time dateTime={application.createdAt}>{chunks}</time>,
                        })}
                    </span>
                    {vacancy?.model && (
                        <span className="text-xs">
                            {t('detail.model', {
                                model: vacancy.model,
                            })}
                        </span>
                    )}
                </div>
            </div>

            {(vacancyUrl || cvUrl) && (
                <div className="flex flex-wrap gap-2">
                    {vacancyUrl && (
                        <Button
                            asChild
                            size="lg"
                            variant={toSend ? 'outline' : 'default'}
                        >
                            <a
                                href={vacancyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLinkIcon aria-hidden="true" />
                                {t('detail.vacancyLink')}
                            </a>
                        </Button>
                    )}
                    {cvUrl && (
                        <>
                            <Button
                                asChild
                                size="lg"
                                variant="outline"
                            >
                                <a
                                    href={cvUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <FileTextIcon aria-hidden="true" />
                                    {t('cv.open')}
                                </a>
                            </Button>
                            <div className="flex items-center">
                                <CopyButton
                                    text={cvUrl}
                                    name={t('workspace.cvLink')}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}

            {channels.length > 0 && (
                <div className="grid gap-2">
                    <h2 className="text-sm font-medium">{t('vacancy.apply')}</h2>
                    <ul className="grid gap-1.5">
                        {channels.map((channel, index) => {
                            const { href, label } = applyChannelLink(channel)
                            return (
                                <li
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a static list per answer
                                    key={index}
                                    className="flex min-w-0 items-center gap-2"
                                >
                                    <span className="shrink-0 text-sm text-muted-foreground">
                                        {t(`vacancy.channel.${channel.kind}`)}:
                                    </span>
                                    {href ? (
                                        <a
                                            href={href}
                                            target={href.startsWith('mailto:') ? undefined : '_blank'}
                                            rel="noopener noreferrer"
                                            className="min-w-0 break-all text-primary underline underline-offset-4 hover:no-underline"
                                        >
                                            {label}
                                        </a>
                                    ) : (
                                        <span className="min-w-0 break-all">{label}</span>
                                    )}
                                    <CopyButton
                                        text={label}
                                        name={label}
                                        variant="ghost"
                                        iconOnly
                                    />
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <StatusControl
                    applicationId={application.id}
                    status={application.status}
                />
                {toSend && (
                    <MarkSentButton
                        applicationId={application.id}
                        size="lg"
                    />
                )}
            </div>
        </header>
    )
}
