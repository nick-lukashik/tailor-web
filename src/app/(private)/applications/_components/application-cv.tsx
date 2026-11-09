'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type ApplicationCv } from '@/lib/api/types'
import { httpUrl } from './vacancy-format'

/** The CV of this application: a link only once tailor-api has made it and gives its address. */
export function ApplicationCvBlock({ cv }: { cv: ApplicationCv }) {
    const t = useTranslations('applications.cv')
    const url = cv.status === 'ready' ? httpUrl(cv.url) : null
    return (
        <section
            aria-labelledby="application-cv-title"
            className="grid gap-2"
        >
            <h2
                id="application-cv-title"
                className="text-xl font-semibold"
            >
                {t('title')}
            </h2>
            {url ? (
                <div>
                    <Button asChild>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t('open')}
                        </a>
                    </Button>
                </div>
            ) : (
                <p className="text-muted-foreground">{cv.status === 'generating' ? t('generating') : t('none')}</p>
            )}
        </section>
    )
}
