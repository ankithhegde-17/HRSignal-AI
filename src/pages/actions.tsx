import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Gauge, ListChecks, Plus, ShieldCheck, Timer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { CardSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ClearFiltersButton, FilterBar, SearchInput, SelectFilter } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { ActionDetailSheet } from "@/components/actions/action-detail-sheet";
import { CreateActionDialog, type CreateActionSeed } from "@/components/insights/create-action-dialog";
import { supabase } from "@/lib/db";
import { useHrProfiles } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate } from "@/lib/format";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_OPTIONS,
  ACTION_STATUS_TONE,
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  PRIORITY_TONE,
  type Approval,
  type HrAction,
} from "@/lib/types";

export default function ActionsPage() {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const { data: hrProfiles = [] } = useHrProfiles();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [owner, setOwner] = useState("all");
  const [approvalState, setApprovalState] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useRealtimeRefresh(["hr_actions", "hr_approvals"], [["actions"], ["approvals"]]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["actions"],
    queryFn: async () => {
      const [actions, approvals] = await Promise.all([
        supabase.from("hr_actions").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("hr_approvals").select("*").order("requested_at", { ascending: false }).limit(500),
      ]);
      if (actions.error) throw new Error(actions.error.message);
      if (approvals.error) throw new Error(approvals.error.message);
      return {
        actions: (actions.data ?? []) as HrAction[],
        approvals: (approvals.data ?? []) as Approval[],
      };
    },
  });

  useEffect(() => {
    if (searchParams.get("new") === "1" && isHr) {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [isHr, searchParams, setSearchParams]);

  const approvalByAction = useMemo(() => {
    const map = new Map<string, Approval>();
    (data?.approvals ?? []).forEach((approval) => {
      const existing = map.get(approval.action_id);
      if (!existing || approval.decision === "pending") map.set(approval.action_id, approval);
    });
    return map;
  }, [data?.approvals]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.actions ?? []).filter((action) => {
      if (status !== "all" && action.status !== status) return false;
      if (priority !== "all" && action.priority !== priority) return false;
      if (owner !== "all" && action.assigned_to !== owner) return false;
      if (approvalState !== "all") {
        const approval = approvalByAction.get(action.id);
        const resolved = approval?.decision ?? (action.approval_required ? "pending" : "none");
        if (approvalState === "none" ? action.approval_required : resolved !== approvalState) return false;
      }
      if (!term) return true;
      return action.title.toLowerCase().includes(term) || (action.description ?? "").toLowerCase().includes(term);
    });
  }, [approvalByAction, data?.actions, owner, priority, search, status, approvalState]);

  const counts = useMemo(() => {
    const actions = data?.actions ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return {
      open: actions.filter((action) => !["resolved", "failed", "dismissed"].includes(action.status)).length,
      awaitingApproval: actions.filter((action) => action.status === "approval_required").length,
      inProgress: actions.filter((action) => action.status === "in_progress").length,
      overdue: actions.filter(
        (action) => action.due_date && action.due_date < today && !["resolved", "failed", "dismissed"].includes(action.status),
      ).length,
      resolved: actions.filter((action) => action.status === "resolved").length,
    };
  }, [data?.actions]);

  const ownerName = useMemo(() => {
    const map = new Map(hrProfiles.map((profileRow) => [profileRow.user_id, profileRow.full_name]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "Unassigned");
  }, [hrProfiles]);

  const columns: Column<HrAction>[] = [
    {
      key: "title",
      header: "Action",
      sortValue: (row) => row.title,
      cell: (row) => (
        <button type="button" className="min-w-0 text-left hover:text-primary" onClick={() => setDetailId(row.id)}>
          <p className="truncate font-medium">{row.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.source_type.replace(/_/g, " ")} · {ownerName(row.assigned_to)}
          </p>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => <StatusBadge value={row.status} labels={ACTION_STATUS_LABELS} tones={ACTION_STATUS_TONE} showIcon />,
    },
    {
      key: "priority",
      header: "Priority",
      sortValue: (row) => row.priority,
      cell: (row) => <StatusBadge value={row.priority} labels={PRIORITY_LABELS} tones={PRIORITY_TONE} />,
      hideBelow: "md",
    },
    {
      key: "approval",
      header: "Approval",
      sortValue: (row) => approvalByAction.get(row.id)?.decision ?? (row.approval_required ? "pending" : "none"),
      cell: (row) => {
        const approval = approvalByAction.get(row.id);
        if (!row.approval_required && !approval) return <span className="text-xs text-muted-foreground">Not required</span>;
        return (
          <ToneBadge
            tone={approval?.decision === "approved" ? "success" : approval?.decision === "rejected" ? "critical" : "warning"}
            showIcon
          >
            {approval?.decision === "approved"
              ? "Approved"
              : approval?.decision === "rejected"
                ? "Rejected"
                : "Pending CEO"}
          </ToneBadge>
        );
      },
      hideBelow: "md",
    },
    {
      key: "due_date",
      header: "Due",
      sortValue: (row) => row.due_date ?? "",
      cell: (row) => {
        const today = new Date().toISOString().slice(0, 10);
        const overdue = row.due_date && row.due_date < today && !["resolved", "failed", "dismissed"].includes(row.status);
        return (
          <span className={`text-sm tabular-nums ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {formatDate(row.due_date)}
          </span>
        );
      },
      hideBelow: "lg",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setDetailId(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  const manualSeed = useMemo<CreateActionSeed | null>(
    () => (createOpen ? { title: "", source_type: "manual" } : null),
    [createOpen],
  );

  const hasFilters = Boolean(search) || status !== "all" || priority !== "all" || owner !== "all" || approvalState !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Action center"
        description="Every workforce action with its owner, workflow timeline and approval state. Sensitive actions require Founder/CEO approval."
        breadcrumbs={[{ label: "Action Center" }]}
        actions={
          isHr ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create action
            </Button>
          ) : null
        }
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={<CardSkeleton count={5} />}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Open actions" value={counts.open} icon={Gauge} tone="workflow" onClick={() => setStatus("all")} hint="Not yet resolved" />
          <KpiCard
            label="Awaiting approval"
            value={counts.awaitingApproval}
            icon={ShieldCheck}
            tone="warning"
            onClick={() => setStatus("approval_required")}
            hint="Founder/CEO decision"
          />
          <KpiCard label="In progress" value={counts.inProgress} icon={ListChecks} tone="primary" onClick={() => setStatus("in_progress")} hint="Work started" />
          <KpiCard
            label="Overdue"
            value={counts.overdue}
            icon={Timer}
            tone={counts.overdue > 0 ? "critical" : "success"}
            hint="Past the due date"
          />
          <KpiCard label="Resolved" value={counts.resolved} icon={CheckCircle2} tone="success" onClick={() => setStatus("resolved")} hint="Closed with evidence" />
        </section>

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search action title or description…" />
          <SelectFilter
            label="Status"
            value={status}
            onChange={setStatus}
            options={ACTION_STATUS_OPTIONS.map((option) => ({ value: option, label: ACTION_STATUS_LABELS[option] }))}
          />
          <SelectFilter
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={PRIORITY_OPTIONS.map((option) => ({ value: option, label: PRIORITY_LABELS[option] }))}
          />
          <SelectFilter
            label="Owner"
            value={owner}
            onChange={setOwner}
            options={hrProfiles.map((profileRow) => ({ value: profileRow.user_id, label: profileRow.full_name }))}
            allLabel="All owners"
          />
          <SelectFilter
            label="Approval"
            value={approvalState}
            onChange={setApprovalState}
            options={[
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "none", label: "Not required" },
            ]}
            allLabel="Any"
          />
          <ClearFiltersButton
            visible={hasFilters}
            onClick={() => {
              setSearch("");
              setStatus("all");
              setPriority("all");
              setOwner("all");
              setApprovalState("all");
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          initialSort={{ key: "due_date", direction: "asc" }}
          pageSize={12}
          caption="Action queue"
          emptyState={
            <EmptyState
              title="No actions match these filters"
              description="Create an action from a risk signal, a recommendation, or directly here."
              icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
              action={
                isHr ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Create action
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </QueryState>

      <ActionDetailSheet actionId={detailId} onClose={() => setDetailId(null)} />
      <CreateActionDialog open={createOpen} onOpenChange={setCreateOpen} seed={manualSeed} />
    </div>
  );
}
