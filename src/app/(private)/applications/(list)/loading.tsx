import { getTranslations } from 'next-intl/server'
import { Skeleton } from '@/components/ui/skeleton'

/** Shown while the server prefetches the applications (navigation to /applications). */
export default async function ApplicationsLoading() {
    const t = await getTranslations('applications')
    return (
        <div
            className="grid gap-8"
            aria-busy="true"
        >
            <header className="grid gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{t('heading')}</h1>
                <p
                    role="status"
                    className="text-muted-foreground"
                >
                    {t('list.loading')}
                </p>
            </header>
            <div className="grid max-w-3xl gap-3">
                {Array.from(
                    {
                        length: 5,
                    },
                    (_, index) => (
                        <Skeleton
                            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
                            key={index}
                            className="h-20"
                        />
                    ),
                )}
            </div>
        </div>
    )
}
