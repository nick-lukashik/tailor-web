'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { type Application } from '@/lib/api/types'
import { applicationTitle } from '../application-title'
import { ApplicationDate } from './application-date'
import { ParseBadge } from './parse-badge'
import { StatusBadge } from './status-badge'

/** One row of the list: a pasted vacancy has no company or role until it is parsed. */
export function ApplicationItem({ application }: { application: Application }) {
    const t = useTranslations('applications')
    return (
        <li>
            <Card size="sm">
                <CardContent className="grid gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold break-words">
                            <Link
                                href={`/applications/${encodeURIComponent(application.id)}`}
                                className="underline-offset-4 hover:underline"
                            >
                                {applicationTitle(application) ?? t('untitled')}
                            </Link>
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                            <ParseBadge status={application.parseStatus} />
                            <StatusBadge status={application.status} />
                        </div>
                    </div>
                    {application.role.trim() && <p className="text-muted-foreground">{application.role}</p>}
                    <p className="text-xs text-muted-foreground">
                        <ApplicationDate value={application.createdAt} />
                    </p>
                </CardContent>
            </Card>
        </li>
    )
}
