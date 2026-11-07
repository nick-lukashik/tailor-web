'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { type ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { getQueryClient } from '@/lib/query/get-query-client'

type ProvidersProps = {
    children: ReactNode
    nonce?: string
    toastLabels: {
        region: string
        close: string
    }
}

/**
 * Client-side providers. The QueryClient comes from getQueryClient (a
 * singleton in the browser), not useState: a render that suspends before
 * mounting would throw a useState client away.
 */
export function Providers({ children, nonce, toastLabels }: ProvidersProps) {
    const queryClient = getQueryClient()
    return (
        <QueryClientProvider client={queryClient}>
            {children}
            <Toaster
                containerAriaLabel={toastLabels.region}
                closeButton
                toastOptions={{
                    closeButtonAriaLabel: toastLabels.close,
                }}
            />
            {/* Renders nothing outside `next dev`, and is left out of production bundles. */}
            <ReactQueryDevtools
                initialIsOpen={false}
                buttonPosition="bottom-left"
                styleNonce={nonce}
            />
        </QueryClientProvider>
    )
}
