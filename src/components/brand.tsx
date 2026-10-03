import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandProps {
  collapsed?: boolean;
  to?: string;
  className?: string;
  tone?: "sidebar" | "default";
}

/**
 * The HR Signal AI wordmark. Uses the brand gradient supplied by the design system.
 */
export function Brand({ collapsed = false, to = "/", className, tone = "sidebar" }: BrandProps) {
  const content = (
    <span className={cn("flex items-center gap-2.5", collapsed && "justify-center gap-0", className)}>
      <span
        className={cn(
          "hr-brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm",
          collapsed && "h-10 w-10",
        )}
      >
        <Radio className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className={cn(
              "truncate text-[15px] font-semibold tracking-tight",
              tone === "sidebar" ? "text-sidebar-foreground" : "text-foreground",
            )}
          >
            HR Signal AI
          </span>
          <span
            className={cn(
              "truncate text-[11px] font-medium uppercase tracking-wider",
              tone === "sidebar" ? "text-sidebar-muted" : "text-muted-foreground",
            )}
          >
            Workforce intelligence
          </span>
        </span>
      )}
    </span>
  );

  if (!to) return content;
  return (
    <Link to={to} className="rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring">
      {content}
    </Link>
  );
}
