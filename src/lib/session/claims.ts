/** The id-api role that opens Tailor (the `roles` claim of the access token). */
export const TAILOR_ROLE = 'tailor'

/**
 * The `roles` claim of an access token, read without checking its signature: the token
 * comes out of the session cookie, which only id-web can seal (AES-256-GCM under
 * SESSION_SECRET), so it is the one id-api issued. This only decides what the site
 * shows; tailor-api verifies the token itself on every call (docs/auth.md).
 * Anything that is not a JWT with a string array there reads as no roles.
 */
export function tokenRoles(accessToken: string): string[] {
    const payload = accessToken.split('.')[1]
    if (!payload) return []
    try {
        const { roles } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
            roles?: unknown
        }
        return Array.isArray(roles) ? roles.filter(role => typeof role === 'string') : []
    } catch {
        return []
    }
}

/** Whether the session's access token carries the `tailor` role. */
export const hasTailorRole = (accessToken: string) => tokenRoles(accessToken).includes(TAILOR_ROLE)
