import { isIP } from 'node:net'
import { REQUEST_ID_HEADER } from '@/lib/request-id'

/**
 * What the API may learn about the visitor. Everything else a browser sends
 * is dropped: Cookie, Authorization, X-Forwarded-*, X-User-* and any other
 * header a client could forge to claim an identity (docs/auth.md).
 */
const VISITOR_HEADERS = [
    'accept-language',
    'user-agent',
]

/** The proxy also passes the request's content negotiation. */
const PROXY_HEADERS = [
    'accept',
    'content-type',
    ...VISITOR_HEADERS,
]

/**
 * The visitor's address as the edge saw it. Traefik (real-ip middleware)
 * overwrites any value a client sends, and only Traefik reaches the web pods.
 */
const EDGE_CLIENT_IP = 'x-real-ip'

/** Request headers to read from: `Headers`, or Next's read-only `headers()`. */
type Incoming = Pick<Headers, 'get'>

function pick(incoming: Incoming, names: string[]): Record<string, string> {
    const picked: Record<string, string> = {}
    for (const name of names) {
        const value = incoming.get(name)
        if (value) picked[name] = value
    }
    const ip = incoming.get(EDGE_CLIENT_IP)?.trim()
    // One address the API's rate limiter reads (Express `trust proxy`).
    if (ip && isIP(ip)) picked['x-forwarded-for'] = ip
    return picked
}

/** Headers for the API on server-side calls (Server Components, metadata). */
export function visitorHeaders(incoming: Incoming): Record<string, string> {
    return pick(incoming, VISITOR_HEADERS)
}

/** The allow-list of request headers the /api proxy forwards. */
export function proxiedRequestHeaders(incoming: Incoming, requestId: string): Headers {
    return new Headers({
        ...pick(incoming, PROXY_HEADERS),
        [REQUEST_ID_HEADER]: requestId,
    })
}
