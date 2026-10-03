import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/types";

const TONE_RING: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  insight: "bg-insight-soft text-insight",
  workflow: "bg-workflow-soft text-workflow",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
};

export interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  trend?: { direction: "up" | "down" | "flat"; label: string; positive?: boolean };
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

/**
 * KPI tile. When `onClick` is supplied the tile becomes an actionable drill-down
 * control rather than a static number.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  trend,
  onClick,
  loading,
  className,
}: KpiCardProps) {
  const TrendIcon = trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : Minus;
  const trendTone =
    trend?.positive === undefined
      ? "text-muted-foreground"
      : trend.positive
        ? "text-success"
        : "text-destructive";

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE_RING[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="mt-4 h-9 w-24" />
      ) : (
        <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {trend ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", trendTone)}>
            <TrendIcon className="h-3 w-3" aria-hidden="true" />
            {trend.label}
          </span>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </>
  );

  const baseClass = cn(
    "glass flex w-full flex-col rounded-card border border-border p-5 text-left shadow-card transition-smooth",
    onClick && "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
