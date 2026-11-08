import { type MetadataRoute } from 'next'

/** Nothing here is for crawlers: every path is disallowed, and there is no sitemap. */
export function buildRobots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            disallow: '/',
        },
    }
}
