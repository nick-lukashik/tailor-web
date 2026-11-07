import { describe, expect, it } from 'vitest'
import { proxiedRequestHeaders, visitorHeaders } from './forwarded-headers'

/** What a client can send: content negotiation plus every header that could claim an identity. */
const fromClient = () =>
    new Headers({
        accept: 'application/json',
        'accept-language': 'ru',
        'content-type': 'application/json',
        'user-agent': 'test-agent',
        authorization: 'Bearer forged',
        cookie: 'session=forged',
        'x-forwarded-for': '198.51.100.66',
        'x-forwarded-host': 'evil.example.com',
        'x-forwarded-proto': 'http',
        'x-user-id': 'admin',
        'x-user-roles': 'admin',
        'x-request-id': 'from-the-client-123',
        host: 'example.com',
        'content-length': '13',
        'x-real-ip': '203.0.113.7',
    })

describe('proxiedRequestHeaders', () => {
    it('forwards only the allow-list, our request id and the edge address', () => {
        const headers = proxiedRequestHeaders(fromClient(), 'proxy-request-id')
        expect(Object.fromEntries(headers)).toEqual({
            accept: 'application/json',
            'accept-language': 'ru',
            'content-type': 'application/json',
            'user-agent': 'test-agent',
            'x-forwarded-for': '203.0.113.7',
            'x-request-id': 'proxy-request-id',
        })
    })

    it.for([
        'authorization',
        'cookie',
        'x-forwarded-host',
        'x-user-id',
    ])('drops %s', name => {
        expect(proxiedRequestHeaders(fromClient(), 'id').has(name)).toBe(false)
    })

    it("never passes the client's own X-Forwarded-For", () => {
        const incoming = fromClient()
        incoming.delete('x-real-ip')
        expect(proxiedRequestHeaders(incoming, 'id').has('x-forwarded-for')).toBe(false)
    })

    it.for([
        '203.0.113.7, 198.51.100.66',
        'not an ip',
        '',
    ])('ignores X-Real-Ip %j', value => {
        const incoming = fromClient()
        incoming.set('x-real-ip', value)
        expect(proxiedRequestHeaders(incoming, 'id').has('x-forwarded-for')).toBe(false)
    })

    it('accepts an IPv6 edge address', () => {
        const incoming = fromClient()
        incoming.set('x-real-ip', '2001:db8::7')
        expect(proxiedRequestHeaders(incoming, 'id').get('x-forwarded-for')).toBe('2001:db8::7')
    })
})

describe('visitorHeaders', () => {
    it("keeps the page's content negotiation out of API calls", () => {
        expect(visitorHeaders(fromClient())).toEqual({
            'accept-language': 'ru',
            'user-agent': 'test-agent',
            'x-forwarded-for': '203.0.113.7',
        })
    })
})
