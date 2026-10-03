import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToneBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/states";
import { supabase } from "@/lib/db";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppNotification, Tone } from "@/lib/types";

const TYPE_TONE: Record<AppNotification["type"], Tone> = {
  info: "info",
  success: "success",
  warning: "warning",
  critical: "critical",
  approval: "warning",
  action: "workflow",
  import: "primary",
};

export function NotificationsPopover() {
  const queryClient = useQueryClient();
  useRealtimeRefresh(["hr_notifications"], [["notifications"]]);

  const { data: notifications = [], isLoading } = useQuery<AppNotification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw new Error(error.message);
      return (data ?? []) as AppNotification[];
    },
  });

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read_at).length, [notifications]);

  const markAll = useMutation({
    mutationFn: async () => {
      const ids = notifications.filter((item) => !item.read_at).map((item) => item.id);
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("hr_notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hr_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}>
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading notifications…</p>
        ) : notifications.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No notifications"
              description="Import results, risk alerts and approval decisions will appear here."
              icon={<Bell className="h-5 w-5" aria-hidden="true" />}
            />
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y divide-border">
              {notifications.map((item) => {
                const body = (
                  <div className={cn("flex flex-col gap-1.5 px-4 py-3 text-left", !item.read_at && "bg-primary-soft/40")}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <ToneBadge tone={TYPE_TONE[item.type]}>{item.type}</ToneBadge>
                    </div>
                    {item.body ? <p className="text-xs text-muted-foreground">{item.body}</p> : null}
                    <p className="text-[11px] text-muted-foreground">{formatRelative(item.created_at)}</p>
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.link ? (
                      <Link
                        to={item.link}
                        onClick={() => !item.read_at && markOne.mutate(item.id)}
                        className="block transition-colors hover:bg-muted/60"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full transition-colors hover:bg-muted/60"
                        onClick={() => !item.read_at && markOne.mutate(item.id)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
