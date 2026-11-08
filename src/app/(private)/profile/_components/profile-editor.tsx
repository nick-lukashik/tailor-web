'use client'

import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ChangeEvent, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { browserApi } from '@/lib/api/browser'
import { type ApiError, type ApiIssue, isApiError } from '@/lib/api/errors'
import { profileApi, profileKeys } from '@/lib/api/profile'

type Problem =
    | {
          kind: 'json'
          message: string
      }
    | {
          kind: 'rejected'
          issues: ApiIssue[]
      }
    | {
          kind: 'tooLarge' | 'failed'
      }

/** What went wrong with a save, from tailor-api's error (or the proxy's). */
function problemOf(error: ApiError): Problem {
    if (error.status === 413)
        return {
            kind: 'tooLarge',
        }
    if (error.code === 'VALIDATION_FAILED')
        return {
            kind: 'rejected',
            issues: error.details.length
                ? error.details
                : [
                      {
                          path: '',
                          message: error.message,
                      },
                  ],
        }
    return {
        kind: 'failed',
    }
}

/**
 * The profile as JSON in a textarea (D-98): Save sends the whole document, Upload
 * puts a file's text in the editor (not saved until Save), Download saves what is in
 * the editor. After a save the editor shows the document as tailor-api stored it,
 * every default filled in.
 */
export function ProfileEditor({ initialVersion, initialText }: { initialVersion: number | null; initialText: string }) {
    const t = useTranslations('profileEditor')
    const editorId = useId()
    const fileInput = useRef<HTMLInputElement>(null)
    const [text, setText] = useState(initialText)
    const [version, setVersion] = useState(initialVersion)
    const [problem, setProblem] = useState<Problem | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const save = useMutation({
        mutationKey: [
            ...profileKeys.all,
            'save',
        ],
        mutationFn: async (document: unknown) => {
            const saved = await profileApi.save(browserApi, document)
            const stored = await profileApi.get(browserApi).catch(() => undefined)
            return {
                saved,
                stored,
            }
        },
        onSuccess: ({ saved, stored }) => {
            setVersion(saved.version)
            if (stored) setText(JSON.stringify(stored.document, null, 4))
            setProblem(null)
            setNotice(
                t('saved', {
                    version: saved.version,
                }),
            )
        },
        onError: error => {
            setNotice(null)
            setProblem(
                isApiError(error)
                    ? problemOf(error)
                    : {
                          kind: 'failed',
                      },
            )
        },
    })

    const submit = () => {
        let document: unknown
        try {
            document = JSON.parse(text)
        } catch (error) {
            setNotice(null)
            setProblem({
                kind: 'json',
                message: error instanceof Error ? error.message : String(error),
            })
            return
        }
        save.mutate(document)
    }

    const upload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setText(await file.text())
        setProblem(null)
        setNotice(
            t('loaded', {
                name: file.name,
            }),
        )
    }

    const download = () => {
        const url = URL.createObjectURL(
            new Blob(
                [
                    text,
                ],
                {
                    type: 'application/json',
                },
            ),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = `tailor-profile${version ? `-v${version}` : ''}.json`
        link.click()
        URL.revokeObjectURL(url)
    }

    return (
        <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={editorId}>{t('label')}</Label>
                <p className="text-sm text-muted-foreground">
                    {version
                        ? t('version', {
                              version,
                          })
                        : t('empty')}
                </p>
            </div>
            <Textarea
                id={editorId}
                value={text}
                onChange={event => setText(event.target.value)}
                spellCheck={false}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${editorId}-problem` : undefined}
                className="max-h-[70vh] min-h-96 font-mono text-sm"
            />
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    onClick={submit}
                    disabled={save.isPending}
                >
                    {save.isPending ? (
                        <>
                            <Loader2Icon
                                aria-hidden="true"
                                className="animate-spin"
                            />
                            {t('saving')}
                        </>
                    ) : (
                        t('save')
                    )}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInput.current?.click()}
                >
                    {t('upload')}
                </Button>
                <input
                    ref={fileInput}
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t('upload')}
                    onChange={upload}
                />
                <Button
                    type="button"
                    variant="outline"
                    onClick={download}
                >
                    {t('download')}
                </Button>
            </div>
            <div aria-live="polite">
                {notice && <p>{notice}</p>}
                {problem && (
                    <div
                        id={`${editorId}-problem`}
                        role="alert"
                        className="grid gap-2 text-destructive"
                    >
                        {problem.kind === 'json' && (
                            <p>
                                {t('invalidJson', {
                                    message: problem.message,
                                })}
                            </p>
                        )}
                        {problem.kind === 'rejected' && (
                            <>
                                <p>{t('rejected')}</p>
                                <ul className="grid gap-1 text-sm">
                                    {problem.issues.map((issue, index) => (
                                        <li
                                            // Paths may repeat with different messages.
                                            // biome-ignore lint/suspicious/noArrayIndexKey: a static list per answer
                                            key={index}
                                        >
                                            <code className="font-mono">{issue.path || t('documentPath')}</code>:{' '}
                                            {issue.message}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        {problem.kind === 'tooLarge' && <p>{t('tooLarge')}</p>}
                        {problem.kind === 'failed' && <p>{t('failed')}</p>}
                    </div>
                )}
            </div>
        </section>
    )
}
