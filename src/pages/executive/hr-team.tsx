import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, Gauge, Timer, UserSearch, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { CardSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { ToneBadge } from "@/components/shared/badges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/lib/db";
import { useHrProfiles } from "@/hooks/use-lookups";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, initials } from "@/lib/format";
import { ROLE_LABELS, type HrAction } from "@/lib/types";

interface TeamRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  lastLogin: string | null;
  assigned: number;
  completed: number;
  overdue: number;
  inProgress: number;
  requisitions: number;
  imports: number;
  workflowCompletion: number;
}

export default function ExecutiveHrTeamPage() {
  const { data: hrProfiles = [] } = useHrProfiles();
  useRealtimeRefresh(["hr_actions", "hr_job_requisitions", "hr_attendance_imports"], [["exec-hr-team"]]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["exec-hr-team"],
    queryFn: async () => {
      const [profiles, employees, actions, requisitions, imports, candidates] = await Promise.all([
        supabase.from("hr_profiles").select("*"),
        supabase.from("hr_employees").select("id, full_name").limit(2000),
        supabase.from("hr_actions").select("*").limit(500),
        supabase.from("hr_job_requisitions").select("id, recruiter_id, status").limit(200),
        supabase.from("hr_attendance_imports").select("id, uploaded_by, status").limit(200),
        supabase.from("hr_candidates").select("id, recruiter_id, current_stage, status").limit(1000),
      ]);
      const firstError = [profiles, employees, actions, requisitions, imports, candidates].find((result) => result.error)?.error;
      if (firstError) throw new Error(firstError.message);
      return {
        profiles: profiles.data ?? [],
        employees: employees.data ?? [],
        actions: (actions.data ?? []) as HrAction[],
        requisitions: requisitions.data ?? [],
        imports: imports.data ?? [],
        candidates: candidates.data ?? [],
      };
    },
  });

  const rows = useMemo<TeamRow[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (data?.profiles ?? []).map((profile) => {
      const owned = (data?.actions ?? []).filter((action) => action.assigned_to === profile.user_id);
      const completed = owned.filter((action) => action.status === "resolved");
      const openOwned = owned.filter((action) => !["resolved", "failed", "dismissed"].includes(action.status));
      return {
        userId: profile.user_id,
        name: profile.full_name,
        email: profile.email,
        role: profile.role,
        lastLogin: profile.last_login_at,
        assigned: owned.length,
        completed: completed.length,
        overdue: openOwned.filter((action) => action.due_date && action.due_date < today).length,
        inProgress: owned.filter((action) => action.status === "in_progress").length,
        requisitions: (data?.requisitions ?? []).filter((requisition) => requisition.recruiter_id === profile.user_id).length,
        imports: (data?.imports ?? []).filter((record) => record.uploaded_by === profile.user_id).length,
        workflowCompletion: owned.length ? (completed.length / owned.length) * 100 : 0,
      };
    });
  }, [data]);

  const columns: Column<TeamRow>[] = [
    {
      key: "name",
      header: "Team member",
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
              {initials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortValue: (row) => row.role,
      cell: (row) => (
        <ToneBadge tone={row.role === "founder" ? "insight" : "primary"}>
          {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}
        </ToneBadge>
      ),
    },
    { key: "assigned", header: "Assigned", align: "right", sortValue: (row) => row.assigned, cell: (row) => <span className="tabular-nums">{row.assigned}</span> },
    { key: "completed", header: "Completed", align: "right", sortValue: (row) => row.completed, cell: (row) => <span className="tabular-nums">{row.completed}</span>, hideBelow: "sm" },
    {
      key: "overdue",
      header: "Overdue",
      align: "right",
      sortValue: (row) => row.overdue,
      cell: (row) => (
        <span className={`tabular-nums ${row.overdue > 0 ? "font-medium text-destructive" : ""}`}>{row.overdue}</span>
      ),
      hideBelow: "md",
    },
    { key: "inProgress", header: "In progress", align: "right", sortValue: (row) => row.inProgress, cell: (row) => <span className="tabular-nums">{row.inProgress}</span>, hideBelow: "lg" },
    { key: "requisitions", header: "Requisitions", align: "right", sortValue: (row) => row.requisitions, cell: (row) => <span className="tabular-nums">{row.requisitions}</span>, hideBelow: "lg" },
    { key: "imports", header: "Imports", align: "right", sortValue: (row) => row.imports, cell: (row) => <span className="tabular-nums">{row.imports}</span>, hideBelow: "lg" },
    {
      key: "workflowCompletion",
      header: "Completion",
      align: "right",
      sortValue: (row) => row.workflowCompletion,
      cell: (row) => (
        <ToneBadge tone={row.workflowCompletion >= 80 ? "success" : row.workflowCompletion >= 50 ? "warning" : "critical"}>
          {row.workflowCompletion.toFixed(0)}%
        </ToneBadge>
      ),
    },
    {
      key: "lastLogin",
      header: "Last sign-in",
      sortValue: (row) => row.lastLogin ?? "",
      cell: (row) => <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.lastLogin)}</span>,
      hideBelow: "md",
    },
  ];

  const totals = useMemo(
    () => ({
      assigned: rows.reduce((total, row) => total + row.assigned, 0),
      completed: rows.reduce((total, row) => total + row.completed, 0),
      overdue: rows.reduce((total, row) => total + row.overdue, 0),
      requisitions: rows.reduce((total, row) => total + row.requisitions, 0),
      imports: rows.reduce((total, row) => total + row.imports, 0),
      workforceManaged: data?.employees.length ?? 0,
      candidatesOwned: data?.candidates.length ?? 0,
    }),
    [data?.candidates.length, data?.employees.length, rows],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="HR team"
        description="Workload, throughput and ownership across the HR function."
        breadcrumbs={[{ label: "Executive Overview", to: "/executive" }, { label: "HR Team" }]}
      />

      <QueryState
        isLoading={isLoading || hrProfiles.length === 0}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Assigned actions" value={totals.assigned} icon={Gauge} tone="workflow" hint={`${totals.completed} completed`} />
          <KpiCard label="Overdue actions" value={totals.overdue} icon={Timer} tone={totals.overdue > 0 ? "critical" : "success"} hint="Past the due date" />
          <KpiCard label="Requisitions owned" value={totals.requisitions} icon={UserSearch} tone="primary" hint={`${totals.candidatesOwned} candidates in pipeline`} />
          <KpiCard label="Attendance imports" value={totals.imports} icon={ClipboardList} tone="info" hint="Uploaded by the team" />
        </section>

        <section className="space-y-3">
          <SectionHeader title="Team performance" description="Select any column to re-sort the comparison" />
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.userId}
            initialSort={{ key: "assigned", direction: "desc" }}
            pageSize={10}
            caption="HR team performance"
            emptyState={
              <EmptyState
                title="No HR profiles"
                description="Provision HR Signal AI accounts to see team performance."
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
              />
            }
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              Workflow completion
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {totals.assigned > 0
                ? `${totals.completed} of ${totals.assigned} actions assigned across the team are resolved (${((totals.completed / totals.assigned) * 100).toFixed(0)}%).`
                : "No actions have been assigned yet."}
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              Attention needed
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {totals.overdue > 0
                ? `${totals.overdue} action${totals.overdue === 1 ? "" : "s"} are past their due date and still open.`
                : "No actions are past their due date."}
            </p>
          </section>
        </div>
      </QueryState>
    </div>
  );
}
