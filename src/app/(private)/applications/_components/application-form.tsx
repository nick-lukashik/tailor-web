'use client'

import { useTranslations } from 'next-intl'
import { type ApplyForm, type MaterialsAnswer } from '@/lib/api/types'
import { allAnswersText, fieldLabel, formRows, shortLabel } from './apply-form-view'
import { CopyButton } from './copy-button'

type Props = {
    form: ApplyForm | null
    answers: MaterialsAnswer[]
    cvUrl: string | null
}

/**
 * The questions of the vacancy's apply form with the written answers, each
 * copied in one click; a file field asks for the CV. Hidden without a form.
 */
export function ApplicationForm({ form, answers, cvUrl }: Props) {
    const t = useTranslations('applications.form')
    const tWorkspace = useTranslations('applications.workspace')
    const rows = formRows(form, answers)
    if (rows.length === 0) return null
    const allText = allAnswersText(rows)
    return (
        <section
            aria-labelledby="application-form-title"
            className="grid min-w-0 gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                    id="application-form-title"
                    className="text-xl font-semibold"
                >
                    {t('title')}
                </h2>
                {allText && (
                    <CopyButton
                        text={allText}
                        name={t('answers')}
                        label={t('copyAll')}
                    />
                )}
            </div>
            <ol className="grid gap-4">
                {rows.map(({ field, answer }) => {
                    const label = fieldLabel(field)
                    const hint = [
                        field.required && t('required'),
                        t(`type.${field.type}`),
                    ]
                        .filter(Boolean)
                        .join(' · ')
                    const copy =
                        field.type === 'file'
                            ? cvUrl && (
                                  <CopyButton
                                      text={cvUrl}
                                      name={tWorkspace('cvLink')}
                                  />
                              )
                            : answer?.trim() && (
                                  <CopyButton
                                      text={answer.trim()}
                                      name={shortLabel(label)}
                                  />
                              )
                    return (
                        <li
                            key={field.key}
                            className="grid min-w-0 gap-2"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="grid min-w-0 gap-0.5">
                                    <h3 className="font-semibold break-words">{label}</h3>
                                    <p className="text-xs text-muted-foreground">{hint}</p>
                                </div>
                                {copy}
                            </div>
                            {field.options && field.options.length > 0 && (
                                <ul
                                    aria-label={t('options')}
                                    className="flex flex-wrap gap-1.5"
                                >
                                    {field.options.map((option, index) => (
                                        <li
                                            // biome-ignore lint/suspicious/noArrayIndexKey: a static list per form
                                            key={index}
                                            className="rounded-md border border-border px-2 py-0.5 text-xs break-words"
                                        >
                                            {option}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {field.type === 'file' ? (
                                <p className="text-muted-foreground">{t('attachCv')}</p>
                            ) : answer?.trim() ? (
                                <div className="rounded-lg border border-border bg-muted/40 p-3 whitespace-pre-wrap break-words">
                                    {answer.trim()}
                                </div>
                            ) : (
                                <p className="text-muted-foreground">{answer === null ? t('noAnswer') : t('fillIn')}</p>
                            )}
                        </li>
                    )
                })}
            </ol>
        </section>
    )
}
