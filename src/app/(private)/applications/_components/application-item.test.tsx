import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en.json'
import { type Application } from '@/lib/api/types'
import { ApplicationItem } from './application-item'

const { stage, cv, workspace } = en.applications

const base: Application = {
    id: 'application-1',
    company: 'Example Ltd',
    role: 'Engineer',
    vacancyUrl: 'https://jobs.example.com/1',
    vacancyText: '',
    status: 'new',
    vacancyId: null,
    parseStatus: null,
    cvStatus: 'none',
    materialsStatus: 'none',
    createdAt: '2026-11-02T10:00:00.000Z',
}

/** How React escapes text in HTML (the apostrophe of "Couldn't read"). */
const escaped = (text: string) => text.replaceAll("'", '&#x27;')

const render = (changes: Partial<Application>) =>
    renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
            <NextIntlClientProvider
                locale="en"
                messages={en}
                timeZone="UTC"
            >
                <ApplicationItem
                    application={{
                        ...base,
                        ...changes,
                    }}
                />
            </NextIntlClientProvider>
        </QueryClientProvider>,
    )

describe('ApplicationItem', () => {
    it('shows the company, the role and the stage', () => {
        const html = render({})
        expect(html).toContain('href="/applications/application-1"')
        expect(html).toContain('>Example Ltd</a>')
        expect(html).toContain('>Engineer</p>')
        expect(html).toContain(`>${stage.incomplete}</span>`)
    })

    it('names a vacancy without a company by its link host, with no role line', () => {
        const html = render({
            company: '',
            role: '',
            parseStatus: 'pending',
        })
        expect(html).toContain('>jobs.example.com</a>')
        expect(html).not.toContain('Engineer')
        expect(html).toContain(`>${stage.reading}</span>`)
    })

    it('says "Untitled vacancy" without a company and a link', () => {
        const html = render({
            company: '',
            vacancyUrl: null,
        })
        expect(html).toContain(`>${en.applications.untitled}</a>`)
    })

    it('says why a failed one failed', () => {
        const html = render({
            parseStatus: 'failed',
        })
        expect(html).toContain(`>${stage.failed}</span>`)
        expect(html).toContain(`>${escaped(en.applications.parse.failed)}</span>`)
        expect(
            render({
                parseStatus: 'parsed',
                cvStatus: 'failed',
            }),
        ).toContain(`>${cv.badge.failed}</span>`)
    })

    it('offers "Open CV" and "Mark as sent" when it is ready to send', () => {
        const html = render({
            parseStatus: 'parsed',
            cvStatus: 'ready',
            materialsStatus: 'ready',
        })
        expect(html).toContain(`>${stage.ready}</span>`)
        expect(html).toMatch(
            /<a[^>]*href="\/applications\/application-1\/cv"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
        )
        expect(html).toContain(`${cv.open}</a>`)
        expect(html).toContain(`${workspace.markSent}</button>`)
        // The stage says it all: no CV badge on top.
        expect(html).not.toContain(cv.badge.ready)
    })

    it('keeps "Open CV" and the CV badge of a sent one, without "Mark as sent"', () => {
        const html = render({
            status: 'sent',
            parseStatus: 'parsed',
            cvStatus: 'ready',
            materialsStatus: 'ready',
        })
        expect(html).toContain(`>${stage.sent}</span>`)
        expect(html).toContain(`>${cv.badge.ready}</span>`)
        expect(html).toContain(`${cv.open}</a>`)
        expect(html).not.toContain(workspace.markSent)
    })

    it('has no quick actions before the CV is ready', () => {
        const html = render({
            parseStatus: 'parsed',
            cvStatus: 'generating',
        })
        expect(html).toContain(`>${stage.generating}</span>`)
        expect(html).not.toContain(cv.open)
        expect(html).not.toContain('<button')
    })
})
