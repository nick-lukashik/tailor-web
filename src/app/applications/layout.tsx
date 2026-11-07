import { type Metadata } from 'next'

/** Applications are private work, not content: never indexed, never in the sitemap. */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
}

export default function ApplicationsLayout({ children }: LayoutProps<'/applications'>) {
    return children
}
