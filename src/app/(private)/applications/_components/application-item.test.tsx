import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en.json'
import { type Application } from '@/lib/api/types'
import { ApplicationItem } from './application-item'

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
    createdAt: '2026-11-02T10:00:00.000Z',
}

/** How React escapes text in HTML (the apostrophe of "Couldn't read"). */
const escaped = (text: string) => text.replaceAll("'", '&#x27;')

const render = (changes: Partial<Application>) =>
    renderToStaticMarkup(
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
        </NextIntlClientProvider>,
    )

describe('ApplicationItem', () => {
    it('shows the company, the role and the status', () => {
        const html = render({})
        expect(html).toContain('href="/applications/application-1"')
        expect(html).toContain('>Example Ltd</a>')
        expect(html).toContain('>Engineer</p>')
        expect(html).toContain(en.applications.status.new)
    })

    it('names a vacancy without a company by its link host, with no role line', () => {
        const html = render({
            company: '',
            role: '',
            parseStatus: 'pending',
        })
        expect(html).toContain('>jobs.example.com</a>')
        expect(html).not.toContain('</p><p')
        expect(html).not.toContain('Engineer')
    })

    it('says "Untitled vacancy" without a company and a link', () => {
        const html = render({
            company: '',
            vacancyUrl: null,
        })
        expect(html).toContain(`>${en.applications.untitled}</a>`)
    })

    it.each([
        [
            'pending',
            en.applications.parse.pending,
        ],
        [
            'failed',
            en.applications.parse.failed,
        ],
    ] as const)('shows the %s parse state', (parseStatus, label) => {
        expect(
            render({
                parseStatus,
            }),
        ).toContain(`>${escaped(label)}</span>`)
    })

    it.each([
        'parsed',
        null,
    ] as const)('shows no parse state for %j', parseStatus => {
        const html = render({
            parseStatus,
        })
        expect(html).not.toContain(en.applications.parse.pending)
        expect(html).not.toContain(escaped(en.applications.parse.failed))
    })

    it.each([
        [
            'ready',
            en.applications.cv.badge.ready,
        ],
        [
            'queued',
            en.applications.cv.badge.generating,
        ],
        [
            'generating',
            en.applications.cv.badge.generating,
        ],
        [
            'failed',
            en.applications.cv.badge.failed,
        ],
    ] as const)('shows the %s CV state', (cvStatus, label) => {
        expect(
            render({
                cvStatus,
            }),
        ).toContain(`>${label}</span>`)
    })

    it('shows no CV state before the first version, and links no CV', () => {
        const html = render({})
        for (const label of Object.values(en.applications.cv.badge)) expect(html).not.toContain(label)
        expect(
            render({
                cvStatus: 'ready',
            }),
        ).not.toContain('cv.example.com')
    })
})
