import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en.json'
import { applicationKeys } from '@/lib/api/applications'
import {
    type ApplicationCv,
    type ApplicationDetail,
    type ApplicationMaterials,
    type MaterialsContent,
    type ParsedVacancy,
} from '@/lib/api/types'
import { ApplicationCvBlock } from './application-cv'
import { ApplicationMessages } from './application-messages'
import { ApplicationView } from './application-view'

const { vacancy: text, detail, cv: cvText, messages, workspace, stage } = en.applications

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
    cvStatus: 'none',
    materialsStatus: 'none',
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
    materials: {
        status: 'none',
    },
}

const CV_URL = 'https://cv.example.com/application-1/Alex-Engineer-CV.pdf'
const content: MaterialsContent = {
    language: 'en',
    coverLetter: 'Dear team,\n\nI would like to apply.',
    emailSubject: 'Backend engineer: Alex Example',
    emailBody: `Hello,\n\nMy CV: ${CV_URL}`,
    telegramMessage: `Hi! CV: ${CV_URL}`,
    linkedinNote: 'Hi, glad to connect.',
    whyMe: [
        'Five years of TypeScript',
    ],
}
/** Ready to send: the CV and the messages are made. */
const ready: ApplicationDetail = {
    ...base,
    cvStatus: 'ready',
    materialsStatus: 'ready',
    cv: {
        status: 'ready',
        version: 1,
        url: CV_URL,
    },
    materials: {
        status: 'ready',
        version: 1,
        content,
    },
}

const withIntl = (node: ReactNode) => (
    <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider
            locale="en"
            messages={en}
            timeZone="UTC"
        >
            {node}
        </NextIntlClientProvider>
    </QueryClientProvider>
)

function renderView(application: ApplicationDetail) {
    const client = new QueryClient()
    client.setQueryData(applicationKeys.detail(application.id), application)
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <NextIntlClientProvider
                locale="en"
                messages={en}
                timeZone="UTC"
            >
                <ApplicationView id={application.id} />
            </NextIntlClientProvider>
        </QueryClientProvider>,
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

    it('offers to generate the CV of a read vacancy and links no CV', () => {
        const html = renderView(base)
        expect(html).toContain(`>${cvText.generate}</button>`)
        expect(html).not.toContain(cvText.open)
        expect(html).not.toMatch(/href="[^"]*\/cv/)
    })

    it('says the CV comes after the vacancy is read', () => {
        const html = renderView(
            withVacancy({
                parseStatus: 'pending',
                parsed: null,
            }),
        )
        expect(html).toContain(`>${cvText.waiting}</p>`)
        expect(html).not.toContain(cvText.generate)
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
        expect(html).toContain(`>${cvText.noVacancy}</p>`)
    })
})

describe('ApplicationCvBlock', () => {
    const URL = 'https://cv.example.com/application-1/Alex-Engineer-CV.pdf'
    const render = (cv: ApplicationCv) =>
        renderToStaticMarkup(
            withIntl(
                <ApplicationCvBlock
                    applicationId="application-1"
                    cv={cv}
                    vacancy={{
                        parseStatus: 'parsed',
                    }}
                />,
            ),
        )

    it.each([
        'queued',
        'generating',
    ] as const)('says the CV is being generated while %s, with no button', status => {
        const html = render({
            status,
            version: 1,
        })
        expect(html).toContain(cvText.generating)
        expect(html).not.toContain('<a')
        expect(html).not.toContain('<button')
    })

    it('shows the details of a ready CV and "Generate again" (the link is in the header)', () => {
        const html = render({
            status: 'ready',
            version: 2,
            url: URL,
            pages: 2,
            model: 'model-a',
        })
        expect(html).not.toContain('<a')
        expect(html).toContain('>Version 2 · 2 pages · Made by model-a</p>')
        expect(html).toContain(`>${cvText.again}</button>`)
    })

    it('shows the details of a ready CV without an address', () => {
        const html = render({
            status: 'ready',
            version: 1,
            pages: 1,
        })
        expect(html).toContain('>Version 1 · 1 page</p>')
    })

    it.each([
        [
            'storage_not_configured',
            cvText.problem.notConfigured,
        ],
        [
            'llm_timeout',
            cvText.problem.model,
        ],
        [
            'tex_unavailable',
            cvText.problem.failed,
        ],
    ])('explains a failure (%s) and offers to try again', (error, message) => {
        const html = render({
            status: 'failed',
            version: 1,
            error,
        })
        expect(html).toContain(`>${escaped(message)}</p>`)
        expect(html).toContain(`>${cvText.retry}</button>`)
        expect(html).not.toContain('<a')
    })
})

describe('ApplyHeader', () => {
    it('opens the vacancy and the CV, copies the CV link and offers "Mark as sent"', () => {
        const html = renderView(ready)
        expect(html).toContain(`>${stage.ready}</span>`)
        expect(html).toMatch(new RegExp(`<a[^>]*href="${CV_URL}"[^>]*target="_blank"`))
        expect(html).toContain(`${cvText.open}</a>`)
        expect(html).toContain(`aria-label="Copy ${workspace.cvLink}"`)
        expect(html).toContain(`${workspace.markSent}</button>`)
        expect(html).toContain(`>${detail.vacancyLink}</a>`)
    })

    it('presses the current status and has no "Mark as sent" once sent', () => {
        const html = renderView({
            ...ready,
            status: 'sent',
        })
        expect(html).toMatch(new RegExp(`<button[^>]*aria-pressed="true"[^>]*>${en.applications.status.sent}</button>`))
        expect(html).toMatch(new RegExp(`<button[^>]*aria-pressed="false"[^>]*>${en.applications.status.new}</button>`))
        expect(html).not.toContain(workspace.markSent)
    })

    it('keeps the older ready CV linked when a newer one failed', () => {
        const html = renderView({
            ...ready,
            cvStatus: 'failed',
            cv: {
                status: 'failed',
                version: 2,
                url: CV_URL,
                error: 'llm_bad_request',
            },
        })
        expect(html).toContain(`href="${CV_URL}"`)
        expect(html).toContain(`>${stage.failed}</span>`)
    })

    it('links no CV and offers no "Mark as sent" before there is one', () => {
        const html = renderView(base)
        expect(html).not.toContain(cvText.open)
        expect(html).not.toContain(workspace.markSent)
    })
})

describe('ApplicationMessages', () => {
    const render = (materials: ApplicationMaterials, changes: Partial<ApplicationDetail> = {}) =>
        renderToStaticMarkup(
            withIntl(
                <ApplicationMessages
                    application={{
                        ...ready,
                        materials,
                        ...changes,
                    }}
                />,
            ),
        )

    it('opens on the e-mail the vacancy asks for, with copy buttons, the subject length and a mailto link', () => {
        const html = render(ready.materials)
        expect(html).toMatch(/role="tablist"[^>]*aria-label="Message type"/)
        for (const tab of [
            messages.email,
            messages.telegram,
            messages.linkedin,
            messages.coverLetter,
            messages.whyMe,
        ])
            expect(html).toContain(`>${tab}</button>`)
        expect(html).toMatch(new RegExp(`role="tab"[^>]*aria-selected="true"[^>]*>${messages.email}</button>`))
        expect(html).toContain('>Backend engineer: Alex Example</div>')
        expect(html).toContain(`aria-label="Copy ${messages.subject}"`)
        expect(html).toContain(`aria-label="Copy ${messages.body}"`)
        expect(html).toContain(`>${content.emailSubject.length} / 150</span>`)
        expect(html).toContain('href="mailto:jobs@example.com?subject=Backend%20engineer%3A%20Alex%20Example&amp;body=')
        expect(html).toContain(`${messages.regenerate}</button>`)
        expect(html).toContain('Version 1')
    })

    it('opens on Telegram when the vacancy has no e-mail', () => {
        const html = render(ready.materials, {
            vacancy: base.vacancy
                ? {
                      ...base.vacancy,
                      parsed: {
                          ...parsed,
                          applyChannels: [
                              {
                                  kind: 'telegram',
                                  value: '@example_jobs',
                              },
                          ],
                      },
                  }
                : null,
        })
        expect(html).toMatch(new RegExp(`role="tab"[^>]*aria-selected="true"[^>]*>${messages.telegram}</button>`))
        expect(html).toContain(`>${content.telegramMessage.length} / 600</span>`)
    })

    it('shows placeholders while the first version is written, with no button', () => {
        const html = render({
            status: 'generating',
            version: 1,
        })
        expect(html).toContain(`>${messages.generating}</p>`)
        expect(html).toContain('data-slot="skeleton"')
        expect(html).not.toContain('role="tablist"')
        expect(html).not.toContain('<button')
    })

    it('keeps the texts while a newer version is written', () => {
        const html = render({
            status: 'queued',
            version: 2,
            content,
        })
        expect(html).toContain(messages.generatingNewer)
        expect(html).toContain('role="tablist"')
        expect(html).not.toContain(messages.regenerate)
    })

    it('explains a failure and offers to try again', () => {
        const html = render({
            status: 'failed',
            version: 1,
            error: 'no_profile',
        })
        expect(html).toMatch(new RegExp(`role="alert"[^>]*>${messages.problem.noProfile}</p>`))
        expect(html).toContain(`${messages.retry}</button>`)
    })

    it('offers to write them once the CV is ready, and waits for it before', () => {
        expect(
            render({
                status: 'none',
            }),
        ).toContain(`>${messages.generate}</button>`)
        const waiting = render(
            {
                status: 'none',
            },
            {
                cv: {
                    status: 'generating',
                    version: 1,
                },
            },
        )
        expect(waiting).toContain(`>${messages.waitingCv}</p>`)
        expect(waiting).not.toContain('<button')
    })
})
