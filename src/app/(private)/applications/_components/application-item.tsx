'use client'

import { FileTextIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { type Application } from '@/lib/api/types'
import { applicationRole, applicationTitle } from '../application-title'
import { ApplicationDate } from './application-date'
import { MarkSentButton } from './application-status'
import { CvBadge } from './cv-badge'
import { ParseBadge } from './parse-badge'
import { applicationStage } from './stage'
import { StageBadge } from './stage-badge'

/**
 * One row of the list: its stage, and the two steps of applying by hand once
 * the CV is ready. A pasted vacancy has no company or role until it is parsed.
 */
export function ApplicationItem({ application }: { application: Application }) {
    const t = useTranslations('applications')
    const stage = applicationStage(application)
    const role = applicationRole(application)
    const cvReady = application.cvStatus === 'ready'
    const href = `/applications/${encodeURIComponent(application.id)}` as const
    return (
        <li>
            <Card size="sm">
                <CardContent className="grid gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid min-w-0 gap-0.5">
                            <h3 className="font-semibold break-words">
                                <Link
                                    href={href}
                                    className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
                                >
                                    {applicationTitle(application) ?? t('untitled')}
                                </Link>
                            </h3>
                            {role && <p className="break-words text-muted-foreground">{role}</p>}
                        </div>
                        <StageBadge stage={stage} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <ApplicationDate value={application.createdAt} />
                            {/* Only what the stage does not already say: why it failed, a CV of a sent one. */}
                            {application.parseStatus === 'failed' && <ParseBadge status={application.parseStatus} />}
                            {(application.cvStatus === 'failed' || (cvReady && stage !== 'ready')) && (
                                <CvBadge status={application.cvStatus} />
                            )}
                        </div>
                        {cvReady && (
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                >
                                    {/* A route that redirects to the newest ready CV: rows carry no link. */}
                                    <a
                                        href={`${href}/cv`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <FileTextIcon aria-hidden="true" />
                                        {t('cv.open')}
                                    </a>
                                </Button>
                                {application.status === 'new' && (
                                    <MarkSentButton
                                        applicationId={application.id}
                                        size="sm"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </li>
    )
}
