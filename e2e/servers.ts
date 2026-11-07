// Ports and settings of the servers playwright.config.ts starts; specs and
// fixtures read them from here.

/** The site against the mock API, ROBOTS=index (the default baseURL). */
export const SITE_PORT = 3100
/** The same build again with ROBOTS=noindex: indexing is runtime config. */
export const NOINDEX_PORT = 3101
/** The same build with an API that does not answer. */
export const API_DOWN_PORT = 3102
/** The same build against a real API (E2E_API_URL), project real-api. */
export const REAL_API_SITE_PORT = 3103
export const MOCK_API_PORT = 4010
/** Nothing listens here: the API of the API_DOWN_PORT site. */
export const DEAD_API_PORT = 4011

/**
 * The /api proxy's budgets on the SITE_PORT server: shorter than the 10 s
 * defaults (service contract), so the deadline tests are quick.
 */
export const BODY_TIMEOUT_MS = 2000
export const UPSTREAM_TIMEOUT_MS = 4000
