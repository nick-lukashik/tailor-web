'use client'

import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { browserApi } from '@/lib/api/browser'
import { INTAKE_MAX_ITEMS, vacancyMutations } from '@/lib/api/vacancies'
import {
    type IntakeMode,
    type IntakeOutcome,
    type IntakeProblem,
    intakeInput,
    outcomeOf,
    problemOf,
} from './vacancy-intake'

/**
 * "Add vacancy" above the pool: a link and/or the raw text of one vacancy, or
 * (Several links) one link per line, sent as one request. tailor-api checks the
 * rest; its refusal is shown here, the list refetches after a success.
 */
export function AddVacancyForm() {
    const t = useTranslations('applications.intake')
    const id = useId()
    const [mode, setMode] = useState<IntakeMode>('single')
    const [url, setUrl] = useState('')
    const [text, setText] = useState('')
    const [links, setLinks] = useState('')
    const [problem, setProblem] = useState<IntakeProblem | null>(null)
    const [outcome, setOutcome] = useState<IntakeOutcome | null>(null)
    const intake = useMutation(vacancyMutations.intake(browserApi))

    const problemId = `${id}-problem`
    const invalid = problem ? true : undefined
    const describedBy = (hint: string) => (problem ? `${hint} ${problemId}` : hint)

    const switchMode = () => {
        setMode(mode === 'single' ? 'batch' : 'single')
        setProblem(null)
        setOutcome(null)
    }

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (intake.isPending) return
        const draft =
            mode === 'single'
                ? {
                      mode,
                      url,
                      text,
                  }
                : {
                      mode,
                      links,
                  }
        const checked = intakeInput(draft)
        setOutcome(null)
        if ('problem' in checked) {
            setProblem(checked.problem)
            return
        }
        setProblem(null)
        intake.mutate(checked.input, {
            onSuccess: result => {
                if (mode === 'single') {
                    setUrl('')
                    setText('')
                } else setLinks('')
                setOutcome(outcomeOf(mode, result))
            },
            onError: error => setProblem(problemOf(error)),
        })
    }

    return (
        <section
            aria-labelledby={`${id}-title`}
            className="grid max-w-3xl gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                    id={`${id}-title`}
                    className="text-xl font-semibold"
                >
                    {t('title')}
                </h2>
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={switchMode}
                >
                    {mode === 'single' ? t('toBatch') : t('toSingle')}
                </Button>
            </div>
            <form
                noValidate
                onSubmit={submit}
                className="grid gap-4"
            >
                {mode === 'single' ? (
                    <>
                        <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-url`}>{t('url')}</FieldLabel>
                            <Input
                                id={`${id}-url`}
                                type="url"
                                inputMode="url"
                                autoComplete="off"
                                spellCheck={false}
                                value={url}
                                onChange={event => setUrl(event.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={problem ? problemId : undefined}
                            />
                        </Field>
                        <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-text`}>{t('text')}</FieldLabel>
                            <Textarea
                                id={`${id}-text`}
                                value={text}
                                onChange={event => setText(event.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={describedBy(`${id}-text-hint`)}
                                className="max-h-[60vh] min-h-48"
                            />
                            <FieldDescription id={`${id}-text-hint`}>{t('textHint')}</FieldDescription>
                        </Field>
                    </>
                ) : (
                    <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-links`}>{t('links')}</FieldLabel>
                        <Textarea
                            id={`${id}-links`}
                            value={links}
                            onChange={event => setLinks(event.target.value)}
                            spellCheck={false}
                            aria-invalid={invalid}
                            aria-describedby={describedBy(`${id}-links-hint`)}
                            className="max-h-[60vh] min-h-48 font-mono text-sm"
                        />
                        <FieldDescription id={`${id}-links-hint`}>
                            {t('linksHint', {
                                max: INTAKE_MAX_ITEMS,
                            })}
                        </FieldDescription>
                    </Field>
                )}
                <div>
                    <Button
                        type="submit"
                        disabled={intake.isPending}
                    >
                        {intake.isPending ? (
                            <>
                                <Loader2Icon
                                    aria-hidden="true"
                                    className="animate-spin motion-reduce:animate-none"
                                />
                                {t('submitting')}
                            </>
                        ) : (
                            t('submit')
                        )}
                    </Button>
                </div>
                <div aria-live="polite">
                    {outcome && (
                        <p>
                            {outcome.kind === 'batch'
                                ? t('batchResult', {
                                      created: outcome.created,
                                      existing: outcome.existing,
                                  })
                                : t(outcome.kind)}
                        </p>
                    )}
                    {problem && (
                        <div
                            id={problemId}
                            role="alert"
                            className="grid gap-1 text-sm text-destructive"
                        >
                            <IntakeProblemText
                                problem={problem}
                                mode={mode}
                            />
                        </div>
                    )}
                </div>
            </form>
        </section>
    )
}

function IntakeProblemText({ problem, mode }: { problem: IntakeProblem; mode: IntakeMode }) {
    const t = useTranslations('applications.intake')
    switch (problem.kind) {
        case 'empty':
            return <p>{mode === 'single' ? t('emptySingle') : t('emptyBatch')}</p>
        case 'tooMany':
            return (
                <p>
                    {t('tooMany', {
                        count: problem.count,
                        max: INTAKE_MAX_ITEMS,
                    })}
                </p>
            )
        case 'rejected':
            return (
                <>
                    <p>{t('rejected')}</p>
                    <ul className="grid gap-1">
                        {problem.issues.map((issue, index) => (
                            <li
                                // Several issues may share an item and a message.
                                // biome-ignore lint/suspicious/noArrayIndexKey: a static list per answer
                                key={index}
                            >
                                {mode === 'batch' && issue.item !== null
                                    ? t('itemIssue', {
                                          number: issue.item + 1,
                                          message: issue.message,
                                      })
                                    : issue.message}
                            </li>
                        ))}
                    </ul>
                </>
            )
        case 'tooLarge':
            return <p>{t('tooLarge')}</p>
        case 'failed':
            return <p>{t('failed')}</p>
    }
}
