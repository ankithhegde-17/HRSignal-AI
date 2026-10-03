import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/shared/states";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  hideBelow?: "sm" | "md" | "lg";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  pageSize?: number;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  isLoading?: boolean;
  caption?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}

const HIDE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN_CLASSES = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * Sortable, paginated table. Horizontally scrollable inside its own container so
 * narrow viewports never cause page-level overflow.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  initialSort,
  pageSize = 12,
  onRowClick,
  emptyState,
  isLoading,
  caption,
  className,
  rowClassName,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return sort.direction === "asc" ? av - bv : bv - av;
      const comparison = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return copy;
  }, [columns, rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [sorted, currentPage, pageSize],
  );

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "asc" },
    );
    setPage(0);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-card">
        <TableSkeleton rows={6} columns={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn("rounded-card border border-border bg-card shadow-card", className)}>
      <div className="hr-scroll-area w-full overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      ALIGN_CLASSES[column.align ?? "left"],
                      column.hideBelow ? HIDE_CLASSES[column.hideBelow] : undefined,
                      column.headerClassName,
                    )}
                    aria-sort={isSorted ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm hover:text-foreground",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        {isSorted ? (
                          sort!.direction === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "border-b border-border/70 last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-muted/50",
                  rowClassName?.(row),
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-4 py-3 align-middle text-foreground",
                      ALIGN_CLASSES[column.align ?? "left"],
                      column.hideBelow ? HIDE_CLASSES[column.hideBelow] : undefined,
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Showing {currentPage * pageSize + 1}–{Math.min(sorted.length, (currentPage + 1) * pageSize)} of{" "}
            {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Previous page</span>
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
