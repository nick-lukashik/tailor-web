import { type ApplyField, type ApplyForm, type MaterialsAnswer } from '@/lib/api/types'

/**
 * A question of the apply form with its written answer: null for a file field
 * and for a question the messages have no answer to (not written yet); empty
 * when the profile's facts do not answer it.
 */
export type FormRow = {
    field: ApplyField
    answer: string | null
}

/** The answers by the key of their question; the first one wins. */
export function answersByKey(answers: MaterialsAnswer[]): Map<string, string> {
    const byKey = new Map<string, string>()
    for (const { key, answer } of answers) if (!byKey.has(key)) byKey.set(key, answer)
    return byKey
}

/** Every question of the form, in its order, with its answer. */
export function formRows(form: ApplyForm | null, answers: MaterialsAnswer[]): FormRow[] {
    if (!form) return []
    const byKey = answersByKey(answers)
    return form.fields.map(field => ({
        field,
        answer: field.type === 'file' ? null : (byKey.get(field.key) ?? null),
    }))
}

/** The question as the form words it, or its key when it has no label. */
export function fieldLabel(field: Pick<ApplyField, 'key' | 'label'>): string {
    return field.label.trim() || field.key
}

/** A label short enough to name a button and a toast. */
export function shortLabel(label: string, max = 60): string {
    return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label
}

/** Every answer to paste at once: "Label: answer" lines, without files and empty answers. */
export function allAnswersText(rows: FormRow[]): string {
    return rows
        .flatMap(({ field, answer }) => {
            const text = answer?.trim()
            return text
                ? [
                      `${fieldLabel(field)}: ${text}`,
                  ]
                : []
        })
        .join('\n')
}
