import { ImageResponse } from 'next/og'
import en from '@/i18n/messages/en.json'

export const alt = en.meta.ogAlt
export const size = {
    width: 1200,
    height: 630,
}
export const contentType = 'image/png'

/**
 * Share card for every page (Next.js also uses it for twitter:image), drawn
 * once at build time: the site's name only, nothing about what it is for.
 */
export default function OpengraphImage() {
    return new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 80,
                // The site's palette (globals.css): background, foreground, primary, muted text.
                background: '#ffffff',
                color: '#0a0a0a',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 24,
                }}
            >
                <div
                    style={{
                        width: 72,
                        height: 72,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 16,
                        background: '#171717',
                        color: '#ffffff',
                        fontSize: 44,
                        fontWeight: 700,
                    }}
                >
                    N
                </div>
                <div
                    style={{
                        fontSize: 36,
                        fontWeight: 600,
                    }}
                >
                    {en.meta.siteName}
                </div>
            </div>
        </div>,
        size,
    )
}
