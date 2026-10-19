import { Button } from "@/components/ui/button";
import { PAGE_SIZES, pageWindow, type Paged } from "@/lib/list-paging.core";

/**
 * The single Office pagination control. Every list page renders this, so page size, range text and
 * keyboard behaviour stay identical everywhere.
 */
export function ListPagination({
  paged,
  busy,
  onPage,
  onPageSize,
  label = "results",
}: {
  paged: Pick<Paged<unknown>, "page" | "pageSize" | "total" | "totalPages" | "from" | "to">;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
}) {
  const { page, pageSize, total, totalPages, from, to } = paged;
  const items = pageWindow(page, totalPages);
  const range =
    total === 0 ? `No ${label} to show` : `Showing ${from}–${to} of ${total} ${label}`;
  return (
    <nav
      aria-label={`${label} pagination`}
      data-testid="list-pagination"
      className="flex flex-col gap-2 border-t bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {busy ? "Updating…" : range}
        {total > 0 ? ` · Page ${page} of ${totalPages}` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Rows per page
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Previous page"
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>

        <div className="flex items-center gap-1">
          {items.map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === page ? "default" : "outline"}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                className="min-w-8 px-2"
                onClick={() => onPage(item)}
              >
                {item}
              </Button>
            ),
          )}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Next page"
          disabled={busy || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}