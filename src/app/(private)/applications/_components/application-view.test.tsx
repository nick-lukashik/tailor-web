import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en.json'
import { applicationKeys } from '@/lib/api/applications'
import { type ApplicationCv, type ApplicationDetail, type ParsedVacancy } from '@/lib/api/types'
import { ApplicationCvBlock } from './application-cv'
import { ApplicationView } from './application-view'

const { vacancy: text, detail, cv: cvText } = en.applications

/** How React escapes text in HTML (the apostrophe of "Couldn't read"). */
const escaped = (value: string) => value.replaceAll("'", '&#x27;')

const parsed: ParsedVacancy = {
    title: 'Backend engineer',
    company: 'Example GmbH',
    companyDescription: null,
    seniority: 'senior',
    location: 'Berlin',
    remote: 'remote',
    regions: [
        'EU',
    ],
    employmentType: 'contract',
    salary: {
        min: 60_000,
        max: 80_000,
        currency: 'EUR',
        period: 'year',
    },
    language: 'de',
    skills: [
        {
            name: 'TypeScript',
            required: true,
        },
        {
            name: 'Go',
            required: false,
        },
    ],
    requirements: [
        'Five years of backend work',
    ],
    responsibilities: [],
    niceToHave: [],
    applyChannels: [
        {
            kind: 'email',
            value: 'jobs@example.com',
        },
        {
            kind: 'telegram',
            value: '@example_jobs',
        },
    ],
    summary: 'Backend in TypeScript.',
    warnings: [],
}

const base: ApplicationDetail = {
    id: 'application-1',
    company: '',
    role: '',
    vacancyUrl: 'https://jobs.example.com/1',
    vacancyText: '',
    status: 'new',
    vacancyId: 'vacancy-1',
    parseStatus: 'parsed',
    createdAt: '2026-11-02T10:00:00.000Z',
    vacancy: {
        id: 'vacancy-1',
        url: 'https://jobs.example.com/1',
        rawText: 'We are hiring.\n\nRemote.',
        parseStatus: 'parsed',
        parseError: null,
        updatedAt: '2026-11-02T10:01:00.000Z',
        model: 'model-a',
        parsed,
    },
    cv: {
        status: 'none',
    },
}

const withIntl = (node: ReactNode) => (
    <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="UTC"
    >
        {node}
    </NextIntlClientProvider>
)

function renderView(application: ApplicationDetail) {
    const client = new QueryClient()
    client.setQueryData(applicationKeys.detail(application.id), application)
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>{withIntl(<ApplicationView id={application.id} />)}</QueryClientProvider>,
    )
}

const withVacancy = (changes: Partial<NonNullable<ApplicationDetail['vacancy']>>): ApplicationDetail => ({
    ...base,
    vacancy: base.vacancy
        ? {
              ...base.vacancy,
              ...changes,
          }
        : null,
})

describe('ApplicationView', () => {
    it('names the application from the vacancy and shows what was read', () => {
        const html = renderView(base)
        expect(html).toContain('>Example GmbH</h1>')
        expect(html).toContain('>Backend engineer</p>')
        expect(html).toContain('Read by model-a')
        expect(html).toContain('href="https://jobs.example.com/1"')
        expect(html).toContain('>Backend in TypeScript.</p>')
        expect(html).toContain(`>${text.remote.remote}</dd>`)
        expect(html).toContain('>€60,000–€80,000 a year</dd>')
        expect(html).toContain('>German</dd>')
        expect(html).toContain(`>${text.employmentType.contract}</dd>`)
        expect(html).toContain(`TypeScript<span class="sr-only">, ${text.requiredSkill}</span>`)
        expect(html).toContain(`>${text.requiredHint}</p>`)
        expect(html).toContain('>Five years of backend work</li>')
        expect(html).not.toContain(`>${text.responsibilities}</h3>`)
        expect(html).not.toContain(`>${text.niceToHave}</h3>`)
        expect(html).toContain('href="mailto:jobs@example.com"')
        expect(html).toContain('href="https://t.me/example_jobs"')
    })

    it('keeps the original text in a closed block', () => {
        const html = renderView(base)
        expect(html).toMatch(/<details[^>]*><summary[^>]*>Original text<\/summary>/)
        expect(html).not.toMatch(/<details[^>]*open/)
        expect(html).toContain('We are hiring.\n\nRemote.')
    })

    it('hides the original text when there is none', () => {
        const html = renderView(
            withVacancy({
                rawText: ' ',
            }),
        )
        expect(html).not.toContain(detail.originalText)
    })

    it('says the vacancy is being read', () => {
        const html = renderView(
            withVacancy({
                parseStatus: 'pending',
                parsed: null,
                model: null,
            }),
        )
        expect(html).toContain(text.pending)
        expect(html).toContain('>jobs.example.com</h1>')
        expect(html).not.toContain('Read by')
    })

    it.each([
        [
            'no_text',
            text.noText,
        ],
        [
            'model_error',
            text.failed,
        ],
    ])('explains a failure (%s) and offers to read it again', (parseError, message) => {
        const html = renderView(
            withVacancy({
                parseStatus: 'failed',
                parseError,
                parsed: null,
            }),
        )
        expect(html).toContain(`>${escaped(message)}</p>`)
        expect(html).toContain(`>${text.readAgain}</button>`)
    })

    it('says "CV not generated yet" and links no CV', () => {
        const html = renderView(base)
        expect(html).toContain(`>${cvText.none}</p>`)
        expect(html).not.toContain(cvText.open)
        expect(html).not.toMatch(/href="[^"]*\/cv/)
    })

    it('shows the text of an application added by hand, without a vacancy', () => {
        const html = renderView({
            ...base,
            company: 'Hand Ltd',
            vacancyId: null,
            parseStatus: null,
            vacancyText: 'Typed by hand.',
            vacancy: null,
        })
        expect(html).toContain('>Hand Ltd</h1>')
        expect(html).toContain('Typed by hand.')
        expect(html).not.toContain('id="vacancy-title"')
    })
})

describe('ApplicationCvBlock', () => {
    const render = (cv: ApplicationCv) => renderToStaticMarkup(withIntl(<ApplicationCvBlock cv={cv} />))

    it('links nothing until the CV is ready', () => {
        expect(
            render({
                status: 'none',
            }),
        ).not.toContain('<a')
        expect(
            render({
                status: 'generating',
            }),
        ).toContain(cvText.generating)
        expect(
            render({
                status: 'ready',
            }),
        ).not.toContain('<a')
    })

    it('links the ready CV by the address tailor-api gives', () => {
        const html = render({
            status: 'ready',
            url: 'https://cv.example.com/application-1/Alex-Engineer-CV.pdf',
        })
        expect(html).toContain('href="https://cv.example.com/application-1/Alex-Engineer-CV.pdf"')
        expect(html).toContain(`>${cvText.open}</a>`)
    })
})
