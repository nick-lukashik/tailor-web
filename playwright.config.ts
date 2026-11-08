import { defineConfig, devices } from '@playwright/test'
import { type BackendOptions } from './e2e/fixtures'
import {
    API_DOWN_PORT,
    BODY_TIMEOUT_MS,
    DEAD_API_PORT,
    GTM_PORT,
    ID_PORT,
    MOCK_API_PORT,
    REAL_API_SITE_PORT,
    SITE_PORT,
    SSO_HOME_URL,
    SSO_PORT,
    UPSTREAM_TIMEOUT_MS,
} from './e2e/servers'

// The suite runs against the production build (`pnpm build` first) and the
// mock API, both started below: without accounts (as local work), and once
// with accounts on against e2e/mock-id.mjs (as prod). PW_BASE_URL points it at a running site
// instead (then the mock API is yours to start, see e2e/fixtures.ts).
// E2E_API_URL adds a server of the same build against that real API, for the
// real-api project (`pnpm test:e2e:real`, README).
const external = process.env.PW_BASE_URL
const realApi = process.env.E2E_API_URL
const baseURL = external ?? `http://127.0.0.1:${SITE_PORT}`
// Test only: the sealed cookie of this run, shared by the mock account site and the SSO site.
const SESSION_SECRET = 'e2e-site-session-secret-0123456789abcdef'
const site = (port: number, env: Record<string, string>) => ({
    // The same server.js the container runs.
    command: 'node scripts/start-standalone.mjs',
    url: `http://127.0.0.1:${port}/health/live`,
    env: {
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        API_URL: `http://127.0.0.1:${MOCK_API_PORT}`,
        SITE_URL: `http://127.0.0.1:${port}`,
        APP_VERSION: 'e2e',
        LOG_LEVEL: 'warn',
        ...env,
    },
    reuseExistingServer: false,
    timeout: 60_000,
})

export default defineConfig<BackendOptions>({
    testDir: './e2e',
    // The mock API keeps state in memory: one worker, reset before each test.
    workers: 1,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000,
    expect: {
        timeout: 7_000,
    },
    reporter: process.env.CI
        ? [
              [
                  'list',
              ],
              [
                  'html',
                  {
                      open: 'never',
                  },
              ],
          ]
        : [
              [
                  'list',
              ],
          ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
        {
            // The same applications specs against a real API; skipped without E2E_API_URL.
            name: 'real-api',
            testMatch: 'applications.spec.ts',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: external ?? `http://127.0.0.1:${REAL_API_SITE_PORT}`,
                backendKind: 'real',
            },
        },
    ],
    webServer: external
        ? undefined
        : [
              {
                  command: 'node e2e/mock-api/server.ts',
                  url: `http://127.0.0.1:${MOCK_API_PORT}/health/ready`,
                  env: {
                      PORT: String(MOCK_API_PORT),
                      MOCK_DELAY_MS: '700',
                  },
                  reuseExistingServer: false,
              },
              site(SITE_PORT, {
                  API_BODY_TIMEOUT_MS: String(BODY_TIMEOUT_MS),
                  API_REQUEST_TIMEOUT_MS: String(UPSTREAM_TIMEOUT_MS),
              }),
              site(GTM_PORT, {
                  GTM_ID: 'GTM-E2ETEST',
              }),
              {
                  command: 'node e2e/mock-id.mjs',
                  url: `http://127.0.0.1:${ID_PORT}/health`,
                  env: {
                      PORT: String(ID_PORT),
                      SESSION_SECRET,
                  },
                  reuseExistingServer: false,
                  timeout: 30_000,
              },
              // As prod: accounts on, so everything needs a session with the tailor role and /api sends its token.
              site(SSO_PORT, {
                  ID_URL: `http://127.0.0.1:${ID_PORT}`,
                  ID_API_URL: `http://127.0.0.1:${ID_PORT}`,
                  SESSION_SECRET,
                  HOME_URL: SSO_HOME_URL,
              }),
              site(API_DOWN_PORT, {
                  API_URL: `http://127.0.0.1:${DEAD_API_PORT}`,
              }),
              ...(realApi
                  ? [
                        site(REAL_API_SITE_PORT, {
                            API_URL: realApi,
                        }),
                    ]
                  : []),
          ],
})
