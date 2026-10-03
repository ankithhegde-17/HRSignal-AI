import { useNavigate } from "react-router-dom";
import { ChevronDown, ListPlus, Plus, Upload, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

/**
 * "Add / Upload Data" quick action. Founder accounts are read-focused, so the
 * mutation shortcuts are only offered to the HR role.
 */
export function NavQuickActions({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isHr = profile?.role === "hr";

  const go = (path: string) => {
    onNavigate?.();
    navigate(path);
  };

  if (!isHr) {
    return (
      <div className={cn("rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2", collapsed && "px-2")}>
        {!collapsed ? (
          <p className="text-[11px] leading-snug text-sidebar-muted">
            Executive read-only access. Decisions are made in Approvals.
          </p>
        ) : null}
      </div>
    );
  }

  const menu = (
    <DropdownMenuContent align="start" className="w-60">
      <DropdownMenuLabel>Create or import</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => go("/attendance?import=1")}>
        <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
        Upload attendance file
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => go("/workforce/employees?new=1")}>
        <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        Add employee
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => go("/workforce/departments?new=1")}>
        <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        Add department
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => go("/actions?new=1")}>
        <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        Create action
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const triggerButton = (
    <DropdownMenuTrigger asChild>
      <Button
        title={collapsed ? "Add or Upload Data" : undefined}
        aria-label={collapsed ? "Add or Upload Data" : undefined}
        className={cn(
          "btn-gradient-primary text-sidebar-primary-foreground shadow-sm transition hover:brightness-110",
          collapsed ? "h-11 w-11 rounded-lg px-0" : "w-full justify-between",
        )}
      >
        {collapsed ? (
          <Plus className="h-5 w-5" aria-hidden="true" />
        ) : (
          <>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add / Upload Data
            </span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </>
        )}
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {triggerButton}
      {menu}
    </DropdownMenu>
  );
}
