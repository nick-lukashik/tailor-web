import { type Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('home.meta')
    return {
        title: {
            absolute: t('title'),
        },
        description: t('description'),
    }
}

const features = [
    'input',
    'cv',
    'letter',
    'board',
] as const

export default async function HomePage() {
    const t = await getTranslations('home')
    return (
        <div className="grid gap-10">
            <section className="grid max-w-3xl gap-4">
                <h1 className="text-4xl font-bold tracking-tight text-balance">{t('heading')}</h1>
                <p className="text-lg text-muted-foreground text-pretty">{t('lead')}</p>
                <div>
                    <Button
                        asChild
                        size="lg"
                    >
                        <Link href="/applications">{t('cta')}</Link>
                    </Button>
                </div>
            </section>
            <ul className="grid gap-4 sm:grid-cols-2">
                {features.map(feature => (
                    <li key={feature}>
                        <Card className="h-full">
                            <CardContent>
                                <p>{t(`features.${feature}`)}</p>
                            </CardContent>
                        </Card>
                    </li>
                ))}
            </ul>
        </div>
    )
}
