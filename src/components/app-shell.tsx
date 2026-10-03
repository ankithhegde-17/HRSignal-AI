import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarDays, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GlobalSearch } from "@/components/global-search";
import { NotificationsPopover } from "@/components/notifications-popover";
import { SidebarNav } from "@/components/sidebar-nav";
import { UserMenu } from "@/components/user-menu";
import { TeamSelectFilter } from "@/components/shared/team-filter";
import { useGlobalFilters } from "@/providers/filter-provider";
import { supabase } from "@/lib/db";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "hr-signal-sidebar-collapsed";
const DATE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
];

/**
 * Shared application frame: collapsible desktop sidebar, header with global
 * search / notifications / filters, and a mobile drawer. Used by both shells.
 */
export function AppShell() {
  const { departmentId, setDepartmentId, teamId, setTeamId, days, setDays } = useGlobalFilters();

  // Sidebar collapse is a harmless interface preference, so it may live in local storage.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", "filter-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside
        className={cn(
          "hr-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-smooth lg:flex",
          collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        <SidebarNav collapsed={collapsed} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="hr-sidebar w-[17rem] border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <SidebarNav variant="mobile" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass header-tint sticky top-0 z-30 flex h-header shrink-0 items-center gap-2 border-b border-border px-3 shadow-card sm:px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 lg:inline-flex"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>

          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>

          <div className="hidden items-center gap-2 md:flex">
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="h-9 w-[10.5rem]" aria-label="Department filter">
                  <Building2 className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <TeamSelectFilter
                departmentId={departmentId}
                teamId={teamId}
                onTeamChange={setTeamId}
                triggerClassName="h-9 w-[10.5rem]"
              />

              <Select value={String(days || 30)} onValueChange={(value) => setDays(Number(value))}>
                <SelectTrigger className="h-9 w-[9.5rem]" aria-label="Date range filter">
                  <CalendarDays className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          <NotificationsPopover />
          <UserMenu />
        </header>

        <main className="mx-auto w-full max-w-page flex-1 px-3 py-5 sm:px-4 sm:py-6 lg:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
