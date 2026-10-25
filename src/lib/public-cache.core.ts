// Speed (decision 280): the anonymous pages whose server-rendered HTML carries no per-user data (the public calculator at
// `/` and `/calculator`, the sign-in card at `/auth`) may be kept briefly by the browser and the edge instead of being
// rendered for every visit. Short on purpose: a new version's HTML must reach phones within a minute, and the stale-chunk
// recovery already reloads a page whose files have moved on. Signed-in pages and every token link stay `no-store`.
export const PUBLIC_PAGE_CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

/** Headers for a public, per-user-data-free page. */
export const publicPageHeaders = () => ({ "Cache-Control": PUBLIC_PAGE_CACHE_CONTROL });
