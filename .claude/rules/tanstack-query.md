Source: https://tanstack.com/query/latest/llms.txt (official LLM docs index). Condensed from https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr, https://tanstack.com/query/latest/docs/framework/react/guides/query-options, https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults, https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5

# TanStack Query v5 (5.105)

TanStack's official skills loader is TanStack Intent (`npx @tanstack/intent@latest install`), but
`@tanstack/react-query` 5.105 ships no skills, so there is nothing to install yet.

## Where things live

- `src/lib/query/` holds `makeQueryClient()` and `getQueryClient()`. `src/app/providers.tsx` is a `'use client'`
  provider that calls `getQueryClient()`. It must not use `useState(() => new QueryClient())`.
- Each resource has a key factory plus `queryOptions(...)` / `infiniteQueryOptions(...)` / `mutationOptions(...)`
  builders, in `src/lib/api/` or the feature folder. Hooks, prefetches and invalidations all import these.
  Never write the same key inline twice.
- Here: `src/lib/api/applications.ts` has `applicationKeys` and `applicationQueries.*(api, ...)`. The options take the API client
  as their first argument: Server Components pass `await serverApi()` (API_URL, request id forwarded), client
  components pass `browserApi` (same-origin `/api`). Same key, same cache entry, different transport.
- Server Components use `getServerQueryClient()` (`src/lib/query/server.ts`, React `cache`: one per request).
- `Register.defaultError` is `ApiError`, so `query.error.code`, `.status`, `.fieldErrors()` are typed.

## getQueryClient (official Next App Router pattern)

- On the server, create a new client on every call (`environmentManager.isServer()`). In the browser, keep one
  module-level singleton, so a suspending first render doesn't create a second client. `isServer` is deprecated
  in 5.105.
- Set a default `staleTime` above 0 (for example `60 * 1000`). Otherwise hydrated data refetches on mount.
- To stream un-awaited prefetches, configure `dehydrate.shouldDehydrateQuery:
  (q) => defaultShouldDehydrateQuery(q) || q.state.status === 'pending'` and `shouldRedactErrors: () => false`.
  Next needs to see its own errors.

## Server prefetch and hydration

```tsx
const queryClient = getQueryClient()
await queryClient.query(userOptions(id)).catch(noop) // or `void queryClient.query(...).catch(noop)` to stream
return <HydrationBoundary state={dehydrate(queryClient)}><UserCard id={id} /></HydrationBoundary>
```

- 5.105 deprecates `prefetchQuery`, `fetchQuery` and `ensureQueryData` (and their infinite versions). Use
  `queryClient.query(opts)` or `queryClient.infiniteQuery(opts)`. These reject on error, so add `.catch(noop)`
  when prefetching. `{ ...opts, staleTime: 'static' }` replaces `ensureQueryData`.
- After an awaited prefetch, the client child can use `useQuery`. After an un-awaited (pending) prefetch, the
  child must call `useSuspenseQuery` inside `<Suspense>`.
- Query data crosses the RSC boundary, so it must be serializable.
- Don't render server-fetched data in the Server Component and also own it with a client query, because the
  two drift apart after a refetch. The client component should own it.

## queryFn and the API

- A `queryFn` runs on the server during prefetch and in the browser later. Always call the typed client from
  `src/lib/api/`. Never put `fetch('/api/...')` in shared options: the relative URL fails on the server. Never
  call `API_URL` from the browser.
- `queryFn` must throw on non-2xx responses, because `fetch` doesn't. Pass the `signal` from the query context
  to the request so it can be cancelled.
- Don't use Server Actions as a `queryFn`, because they run serially. Mutations may use them.

## v5 API reminders

- Signatures take one object: `useQuery({ queryKey, queryFn })`. `useQuery` has no `onSuccess`, `onError` or
  `onSettled`.
- Renames: `cacheTime` → `gcTime`. Status `'loading'` → `'pending'`, with flag `isPending` (`isLoading` means
  pending and fetching). `keepPreviousData` → `placeholderData: keepPreviousData`. `useErrorBoundary` →
  `throwOnError`. `Hydrate` → `HydrationBoundary`. `suspense: true` → `useSuspenseQuery`.
- Infinite queries require `initialPageParam` and `getNextPageParam`. Use `maxPages` to bound memory.
- Mutation callbacks: `onMutate(variables, context)`, `onSuccess(data, variables, onMutateResult, context)`.
  `context.client` is the QueryClient. Invalidate with `queryClient.invalidateQueries({ queryKey: keys.all })`.
- Disable a query with `enabled: false`, or for type safety `queryFn: skipToken`.
- Never rest-destructure a result (`const { data, ...rest } = useQuery(...)`). It subscribes to every field
  (Biome `noTanstackQueryRestDestructuring`).

## Devtools

- `ReactQueryDevtools` from `@tanstack/react-query-devtools` renders nothing outside development. If the nonce
  CSP blocks its styles, pass the nonce through `styleNonce`.
