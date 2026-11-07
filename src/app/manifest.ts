import { type MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Tailor',
        short_name: 'Tailor',
        description: 'A CV and a cover letter for each vacancy.',
        start_url: '/',
        display: 'standalone',
        // The light palette in globals.css (--background).
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
            {
                src: '/icon',
                sizes: '64x64',
                type: 'image/png',
            },
            {
                src: '/apple-icon',
                sizes: '180x180',
                type: 'image/png',
            },
        ],
    }
}
