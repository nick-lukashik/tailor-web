'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Signed in, not on the allowlist: the user id to send to the owner, ready to copy. */
export function InvitationNotice({ userId }: { userId: string }) {
    const t = useTranslations('access.invite')
    const inputId = useId()
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(userId)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }
    return (
        <section className="mx-auto grid max-w-xl gap-4 py-10">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground">{t('body')}</p>
            <Label htmlFor={inputId}>{t('idLabel')}</Label>
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    id={inputId}
                    readOnly
                    value={userId}
                    onFocus={event => event.target.select()}
                    className="max-w-sm font-mono"
                />
                <Button
                    type="button"
                    variant="outline"
                    onClick={copy}
                >
                    {copied ? t('copied') : t('copy')}
                </Button>
            </div>
        </section>
    )
}
