import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/db";

/**
 * Subscribes to Postgres change events for the supplied tables and invalidates the
 * matching React Query caches so every affected interface refreshes live.
 *
 * A single channel is used per hook instance to avoid reconnecting on each render.
 */
export function useRealtimeRefresh(
  tables: string[],
  queryKeys: string[][] = [],
  channelName = "hr-signal-realtime",
) {
  const queryClient = useQueryClient();
  const tableSignature = tables.join(",");
  const keySignature = queryKeys.map((key) => key.join(".")).join("|");

  useEffect(() => {
    const channel = supabase.channel(`${channelName}:${tableSignature}:${keySignature}`);

    tables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        queryKeys.forEach((key) => {
          void queryClient.invalidateQueries({ queryKey: key });
        });
      });
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableSignature, keySignature, channelName, queryClient]);
}
