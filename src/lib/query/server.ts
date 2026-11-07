import 'server-only'
import { cache } from 'react'
import { makeQueryClient } from './get-query-client'

/**
 * One QueryClient per server request, shared by the layouts, pages and
 * generateMetadata of that request and dropped with it.
 */
export const getServerQueryClient = cache(makeQueryClient)
