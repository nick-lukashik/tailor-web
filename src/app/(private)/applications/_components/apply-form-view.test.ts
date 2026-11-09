import { describe, expect, it } from 'vitest'
import { type ApplyForm, type MaterialsAnswer } from '@/lib/api/types'
import { allAnswersText, answersByKey, fieldLabel, formRows, shortLabel } from './apply-form-view'

const form: ApplyForm = {
    source: 'greenhouse',
    fields: [
        {
            key: 'first_name',
            label: 'First name',
            type: 'text',
            required: true,
        },
        {
            key: 'resume',
            label: 'Resume/CV',
            type: 'file',
            required: true,
        },
        {
            key: 'question_1',
            label: 'Authorized to work?',
            type: 'select',
            required: true,
            options: [
                'Yes',
                'No',
            ],
        },
        {
            key: 'question_2',
            label: ' ',
            type: 'textarea',
            required: false,
        },
        {
            key: 'question_3',
            label: 'Start date',
            type: 'text',
            required: false,
        },
    ],
}

const answers: MaterialsAnswer[] = [
    {
        key: 'question_1',
        label: 'Authorized to work?',
        answer: 'Yes',
    },
    {
        key: 'first_name',
        label: 'First name',
        answer: ' Alex ',
    },
    {
        key: 'question_2',
        label: '',
        answer: 'Line one\nline two',
    },
    {
        key: 'question_3',
        label: 'Start date',
        answer: '',
    },
    {
        key: 'first_name',
        label: 'First name',
        answer: 'Duplicate',
    },
]

describe('answersByKey', () => {
    it('maps each key to its first answer', () => {
        const byKey = answersByKey(answers)
        expect(byKey.get('first_name')).toBe(' Alex ')
        expect(byKey.get('question_1')).toBe('Yes')
        expect(byKey.size).toBe(4)
    })

    it('is empty without answers', () => {
        expect(answersByKey([]).size).toBe(0)
    })
})

describe('formRows', () => {
    it('pairs every field with its answer by key, in the form order', () => {
        expect(
            formRows(form, answers).map(row => [
                row.field.key,
                row.answer,
            ]),
        ).toEqual([
            [
                'first_name',
                ' Alex ',
            ],
            [
                'resume',
                null,
            ],
            [
                'question_1',
                'Yes',
            ],
            [
                'question_2',
                'Line one\nline two',
            ],
            [
                'question_3',
                '',
            ],
        ])
    })

    it('leaves a question without an answer as null, a file field too', () => {
        const rows = formRows(form, [])
        expect(rows.map(row => row.answer)).toEqual([
            null,
            null,
            null,
            null,
            null,
        ])
    })

    it('is empty without a form', () => {
        expect(formRows(null, answers)).toEqual([])
    })
})

describe('allAnswersText', () => {
    it('makes "Label: answer" lines without files and empty answers', () => {
        expect(allAnswersText(formRows(form, answers))).toBe(
            [
                'First name: Alex',
                'Authorized to work?: Yes',
                'question_2: Line one\nline two',
            ].join('\n'),
        )
    })

    it('is empty when nothing is answered', () => {
        expect(allAnswersText(formRows(form, []))).toBe('')
    })
})

describe('labels', () => {
    it('falls back to the key for a blank label', () => {
        expect(
            fieldLabel({
                key: 'question_2',
                label: '  ',
            }),
        ).toBe('question_2')
    })

    it('shortens a long label for a button name', () => {
        expect(shortLabel('Short')).toBe('Short')
        const long = shortLabel('a'.repeat(100))
        expect(long).toHaveLength(60)
        expect(long.endsWith('…')).toBe(true)
    })
})
