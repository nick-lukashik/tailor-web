import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en.json'
import { AddVacancyForm } from './add-vacancy-form'

const { intake } = en.applications

describe('AddVacancyForm', () => {
    it('starts with a link, the vacancy text and an enabled Add button', () => {
        const html = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <NextIntlClientProvider
                    locale="en"
                    messages={en}
                    timeZone="UTC"
                >
                    <AddVacancyForm />
                </NextIntlClientProvider>
            </QueryClientProvider>,
        )
        expect(html).toContain(`>${intake.title}</h2>`)
        expect(html).toContain(`>${intake.url}</label>`)
        expect(html).toContain(`>${intake.text}</label>`)
        expect(html).toContain('type="url"')
        expect(html).toContain(`>${intake.toBatch}</button>`)
        expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${intake.submit}</button>`))
        expect(html).not.toMatch(/type="submit"[^>]*disabled/)
        expect(html).not.toContain('role="alert"')
    })
})
