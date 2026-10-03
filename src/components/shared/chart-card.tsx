import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Chart container. `summary` is a mandatory plain-language description so the
 * data is available to screen readers and when colour is not perceivable.
 */
export function ChartCard({
  title,
  description,
  summary,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  summary: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("glass flex flex-col rounded-card border border-border shadow-card", className)}>
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("min-w-0 flex-1 p-5", contentClassName)}>
        <p className="sr-only">{summary}</p>
        {children}
      </div>
    </section>
  );
}
