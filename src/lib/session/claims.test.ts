import { describe, expect, it } from 'vitest'
import { hasTailorRole, TAILOR_ROLE, tokenRoles } from './claims'

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (payload: unknown) =>
    `${part({
        alg: 'ES256',
        typ: 'at+jwt',
    })}.${part(payload)}.signature`

describe('tokenRoles', () => {
    it('reads the roles claim of the payload', () => {
        expect(
            tokenRoles(
                jwt({
                    sub: '019a5f00-0000-7000-8000-000000000001',
                    roles: [
                        'support',
                        TAILOR_ROLE,
                    ],
                }),
            ),
        ).toEqual([
            'support',
            'tailor',
        ])
    })

    it('reads no roles from anything else', () => {
        for (const token of [
            '',
            'opaque-token',
            'a.%%%.c',
            `x.${Buffer.from('not json').toString('base64url')}.y`,
            jwt({}),
            jwt({
                roles: 'tailor',
            }),
            jwt(null),
        ])
            expect(tokenRoles(token), token).toEqual([])
        expect(
            tokenRoles(
                jwt({
                    roles: [
                        1,
                        'tailor',
                        null,
                    ],
                }),
            ),
        ).toEqual([
            'tailor',
        ])
    })
})

describe('hasTailorRole', () => {
    it('needs exactly the tailor role', () => {
        expect(
            hasTailorRole(
                jwt({
                    roles: [
                        'tailor',
                    ],
                }),
            ),
        ).toBe(true)
        for (const roles of [
            [],
            [
                'owner',
            ],
            [
                'Tailor',
                'tailors',
            ],
        ])
            expect(
                hasTailorRole(
                    jwt({
                        roles,
                    }),
                ),
                roles.join(','),
            ).toBe(false)
    })
})
