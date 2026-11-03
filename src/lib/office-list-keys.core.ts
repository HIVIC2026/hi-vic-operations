// Speed (portal speed step 1, task 8): the Query keys of the three office lists, in one place so the page and the
// route's early start (office-route-prefetch.ts) can never drift apart — a different key would mean a second call.
// Pure: type-only imports.
import type { JobsLane, SavedView } from "./jobs-columns.core";
import type { ColumnFilters } from "./enquiry-columns.core";
import type { EnquiryView } from "./enquiry-categories.core";
import type { SortDir } from "./office-filters.core";

export const jobsListKey = (lane: JobsLane, view: SavedView, search: string, page: number) => ["office-jobs", lane, view, search, page] as const;
export const enquiriesListKey = (view: EnquiryView, search: string, filters: ColumnFilters, sort: { k: string; d: SortDir }, page: number) => ["office-enquiries", view, search, filters, sort, page] as const;
export const installerWaitingKey = (includeTest: boolean) => ["installer-waiting", includeTest] as const;
