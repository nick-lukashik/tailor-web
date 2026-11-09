'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyText } from './copy-text'

type Props = {
    text: string
    /** What is copied: the button is named "Copy <name>", the toast says "<name> copied". */
    name: string
    /** Only the icon (a value in a list); otherwise the icon and "Copy". */
    iconOnly?: boolean
    variant?: 'default' | 'outline' | 'ghost'
}

const COPIED_MS = 2_000

/** One click puts the text on the clipboard; a toast and a check mark say it worked. */
export function CopyButton({ text, name, iconOnly = false, variant = 'outline' }: Props) {
    const t = useTranslations('applications.copy')
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), COPIED_MS)
        return () => clearTimeout(timer)
    }, [
        copied,
    ])
    const copy = async () => {
        if (await copyText(text)) {
            setCopied(true)
            toast.success(
                t('done', {
                    name,
                }),
            )
        } else toast.error(t('failed'))
    }
    const Icon = copied ? CheckIcon : CopyIcon
    const accessibleName = t('named', {
        name,
    })
    return (
        <Button
            type="button"
            variant={variant}
            size={iconOnly ? 'icon-sm' : 'sm'}
            onClick={copy}
            aria-label={accessibleName}
            title={iconOnly ? accessibleName : undefined}
        >
            <Icon aria-hidden="true" />
            {!iconOnly && t('copy')}
        </Button>
    )
}
