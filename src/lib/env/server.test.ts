import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

async function load(env: Record<string, string>) {
    vi.resetModules()
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    return (await import('./server')).serverEnv
}

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('serverEnv', () => {
    it('falls back to local defaults for unset or blank values', async () => {
        const env = await load({
            API_URL: '',
            SITE_URL: ' ',
            APP_VERSION: '',
            LOG_LEVEL: '',
            API_REQUEST_TIMEOUT_MS: '',
            API_BODY_TIMEOUT_MS: '',
            API_RENDER_TIMEOUT_MS: '',
            HOME_URL: '',
            ID_URL: '',
            ID_API_URL: '',
            SESSION_SECRET: '',
        })
        expect(env).toMatchObject({
            API_URL: 'http://localhost:4000',
            SITE_URL: 'http://localhost:3000',
            APP_VERSION: 'dev',
            LOG_LEVEL: 'info',
            // Service contract time budgets.
            API_REQUEST_TIMEOUT_MS: 10_000,
            API_BODY_TIMEOUT_MS: 10_000,
            // tailor-api builds the master CV PDF in up to 65 s.
            API_RENDER_TIMEOUT_MS: 70_000,
            HOME_URL: 'https://nick-lukashik.com',
        })
        expect(env.ID_URL).toBeUndefined()
        expect(env.SESSION_SECRET).toBeUndefined()
    })

    it('reads the account', async () => {
        const env = await load({
            ID_URL: 'https://id.example.com/',
            ID_API_URL: 'http://id-api.example.test',
            SESSION_SECRET: 'x'.repeat(32),
        })
        expect(env.ID_URL).toBe('https://id.example.com')
        expect(env.ID_API_URL).toBe('http://id-api.example.test')
    })

    it('reads the landing visitors without access are sent to', async () => {
        const env = await load({
            HOME_URL: 'https://example.com/',
        })
        expect(env.HOME_URL).toBe('https://example.com/')
    })

    it('drops trailing slashes and coerces numbers', async () => {
        const env = await load({
            API_URL: 'https://api.example.com/',
            SITE_URL: 'https://example.com//',
            API_REQUEST_TIMEOUT_MS: '2500',
        })
        expect(env.API_URL).toBe('https://api.example.com')
        expect(env.SITE_URL).toBe('https://example.com')
        expect(env.API_REQUEST_TIMEOUT_MS).toBe(2500)
    })

    it('names every invalid variable', async () => {
        await expect(
            load({
                API_URL: 'not a url',
                LOG_LEVEL: 'loud',
                HOME_URL: 'nowhere',
                SESSION_SECRET: 'short',
            }),
        ).rejects.toThrow(
            /Invalid server environment[\s\S]*API_URL[\s\S]*SESSION_SECRET[\s\S]*HOME_URL[\s\S]*LOG_LEVEL/,
        )
    })
})
