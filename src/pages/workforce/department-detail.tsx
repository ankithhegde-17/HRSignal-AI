import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Briefcase, Building2, Edit, Layers, Plus, ShieldAlert, Users, UserCheck } from "lucide-react";
import { PageHeader, SectionHeader, type Crumb } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, ErrorState, QueryState, TableSkeleton } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { TeamFormDialog, ManageTeamMembersDialog, TeamLeadControl } from "@/components/team/team-dialogs";
import { useTeamMetrics, type TeamMetricRow } from "@/hooks/use-team-metrics";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { supabase } from "@/lib/db";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { toast } from "sonner";
import { TEAM_STATUS_LABELS, TEAM_STATUS_TONE, type Department, type Employee, type Team } from "@/lib/types";
import { CHART_COLORS, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

export default function DepartmentDetailPage() {
  const { departmentId = "" } = useParams();
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const queryClient = useQueryClient();

  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [managingTeam, setManagingTeam] = useState<Team | null>(null);
  const [archivingTeam, setArchivingTeam] = useState<Team | null>(null);

  useRealtimeRefresh(["hr_teams", "hr_employees", "hr_attendance", "hr_performance_reviews", "hr_signals", "hr_actions"], [["department-detail"]]);

  const { data: department } = useQuery<Department | null>({
    queryKey: ["department", departmentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_departments").select("*").eq("id", departmentId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Department | null) ?? null;
    },
  });

  const teamsQuery = useQuery<Team[]>({
    queryKey: ["department-teams", departmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_teams")
        .select("*")
        .eq("department_id", departmentId)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Team[];
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["department-members", departmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select("*")
        .eq("department_id", departmentId)
        .order("full_name")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const teamIds = useMemo(() => (teamsQuery.data ?? []).map((team) => team.id), [teamsQuery.data]);
  const metricsQuery = useTeamMetrics(teamIds);
  const metricRows = useMemo(() => metricsQuery.data ?? [], [metricsQuery.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["teams"] });
    void queryClient.invalidateQueries({ queryKey: ["team-metrics"] });
    void queryClient.invalidateQueries({ queryKey: ["department-teams", departmentId] });
    void queryClient.invalidateQueries({ queryKey: ["department-members", departmentId] });
    void queryClient.invalidateQueries({ queryKey: ["workforce-departments"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const { data: requisitions } = useQuery({
    queryKey: ["department-open-roles", departmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_job_requisitions")
        .select("openings")
        .eq("department_id", departmentId)
        .eq("status", "open");
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((total, row) => total + Number(row.openings ?? 0), 0);
    },
  });

  const { data: openRisks = 0 } = useQuery({
    queryKey: ["department-risks", departmentId],
    queryFn: async () => {
      const employeeIds = employees.map((employee) => employee.id);
      if (employeeIds.length === 0) return 0;
      const { data, error } = await supabase
        .from("hr_signals")
        .select("score")
        .eq("entity_type", "employee")
        .in("entity_id", employeeIds)
        .gte("score", 60);
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  });

  const archiveTeam = async () => {
    if (!archivingTeam) return;
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("team-management", {
      body: { action: "archive", team_id: archivingTeam.id },
      headers: { "Content-Type": "application/json" },
    });
    if (error || !data?.ok) {
      toast.error(data?.message ?? error?.message ?? "The team could not be archived.");
      return;
    }
    toast.success("Team archived. Members and history are preserved.");
    setArchivingTeam(null);
    invalidate();
  };

  const summary = useMemo(() => {
    const active = employees.filter((employee) => employee.status !== "exited");
    const scored = metricRows.map((row) => row.averagePerformance).filter((v): v is number => v != null);
    const attended = metricRows.map((row) => row.attendanceRate).filter((v): v is number => v != null);
    const teamLeads = metricRows.filter((row) => row.leadName).map((row) => row.leadName);
    return {
      total: employees.length,
      active: active.length,
      averagePerformance: scored.length ? scored.reduce((total, value) => total + value, 0) / scored.length : null,
      attendanceRate: attended.length ? attended.reduce((total, value) => total + value, 0) / attended.length : null,
      teams: teamIds.length,
      teamLeads,
      openRoles: requisitions ?? 0,
      openRisks,
    };
  }, [employees, metricRows, teamIds.length, requisitions, openRisks]);

  const comparison = useMemo(
    () =>
      metricRows.map((row) => ({
        name: row.team.name,
        performance: row.averagePerformance ?? 0,
        attendance: row.attendanceRate ?? 0,
        review: row.reviewCompletion,
      })),
    [metricRows],
  );

  const breadcrumbs: Crumb[] = [
    { label: "Workforce", to: "/workforce/employees" },
    { label: "Departments", to: "/workforce/departments" },
    { label: department?.name ?? "Department" },
  ];

  const columns: Column<TeamMetricRow>[] = [
    {
      key: "name",
      header: "Team",
      sortValue: (row) => row.team.name,
      cell: (row) => (
        <Link
          to={`/workforce/departments/${departmentId}/teams/${row.team.id}`}
          className="min-w-0 hover:text-primary"
        >
          <p className="truncate font-medium">{row.team.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.team.team_code}</span> · Lead: {row.leadName ?? "Not assigned"}
          </p>
        </Link>
      ),
    },
    { key: "active", header: "Employees", align: "right", sortValue: (row) => row.active, cell: (row) => <span className="tabular-nums">{row.active}</span> },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      sortValue: (row) => row.capacity ?? 0,
      cell: (row) => (
        <span className={`tabular-nums ${row.utilization != null && row.utilization > 100 ? "font-medium text-destructive" : ""}`}>
          {row.capacity ?? "—"}
        </span>
      ),
      hideBelow: "sm",
    },
    {
      key: "performance",
      header: "Performance",
      align: "right",
      sortValue: (row) => row.averagePerformance ?? -1,
      cell: (row) => <span className="tabular-nums">{formatScore(row.averagePerformance)}</span>,
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      sortValue: (row) => row.attendanceRate ?? -1,
      cell: (row) => (
        <ToneBadge tone={row.attendanceRate == null ? "neutral" : row.attendanceRate >= 90 ? "success" : row.attendanceRate >= 80 ? "warning" : "critical"}>
          {formatPercent(row.attendanceRate)}
        </ToneBadge>
      ),
      hideBelow: "md",
    },
    {
      key: "review",
      header: "Review completion",
      align: "right",
      sortValue: (row) => row.reviewCompletion,
      cell: (row) => (
        <ToneBadge tone={row.reviewCompletion >= 90 ? "success" : row.reviewCompletion >= 60 ? "warning" : "critical"}>
          {row.reviewCompletion.toFixed(0)}%
        </ToneBadge>
      ),
      hideBelow: "lg",
    },
    {
      key: "risks",
      header: "Open risks",
      align: "right",
      sortValue: (row) => row.highCriticalRisks,
      cell: (row) => <RiskBadge score={row.highCriticalRisks} severity={row.highCriticalRisks >= 5 ? "high" : row.highCriticalRisks >= 2 ? "medium" : "low"} />,
      hideBelow: "lg",
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.team.status,
      cell: (row) => <StatusBadge value={row.team.status} labels={TEAM_STATUS_LABELS} tones={TEAM_STATUS_TONE} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${row.team.name}`} asChild>
            <Link to={`/workforce/departments/${departmentId}/teams/${row.team.id}`}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          {isHr ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.team.name}`}
                onClick={() => {
                  setEditingTeam(row.team);
                  setTeamFormOpen(true);
                }}
              >
                <Edit className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Manage ${row.team.name} members`}
                onClick={() => setManagingTeam(row.team)}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
              </Button>
              {row.team.status === "active" ? (
                <Button variant="ghost" size="icon" aria-label={`Archive ${row.team.name}`} onClick={() => setArchivingTeam(row.team)}>
                  <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const isLoading = teamsQuery.isLoading || metricsQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Department"}
        description={department?.description ?? "Department teams and health."}
        breadcrumbs={breadcrumbs}
        actions={
          isHr ? (
            <Button size="sm" onClick={() => { setEditingTeam(null); setTeamFormOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create team
            </Button>
          ) : null
        }
      />

      <QueryState
        isLoading={isLoading || !department}
        isError={teamsQuery.isError || metricsQuery.isError}
        onRetry={() => { void teamsQuery.refetch(); void metricsQuery.refetch(); }}
        loadingFallback={<CardSkeleton count={4} />}
      >
        {!department ? (
          <ErrorState title="Department not found" onRetry={() => undefined} />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Headcount" value={summary.total} icon={Users} tone="primary" hint={`${summary.active} active`} />
              <KpiCard label="Teams" value={summary.teams} icon={Layers} tone="workflow" hint={summary.teamLeads.length ? `Leads: ${summary.teamLeads.join(", ")}` : "No leads assigned"} />
              <KpiCard label="Average performance" value={formatScore(summary.averagePerformance)} icon={Building2} tone="insight" hint="Across teams" />
              <KpiCard label="Attendance rate" value={formatPercent(summary.attendanceRate)} icon={UserCheck} tone={summary.attendanceRate != null && summary.attendanceRate < 85 ? "warning" : "success"} hint="Last 30 days" />
              <KpiCard label="Capacity" value={department.capacity ?? "—"} icon={Building2} tone="neutral" hint={`Open roles: ${summary.openRoles}`} />
              <KpiCard label="Open risks" value={summary.openRisks} icon={ShieldAlert} tone={summary.openRisks > 0 ? "critical" : "success"} hint="High or critical" />
              <KpiCard label="Department code" value={department.code} icon={Building2} tone="neutral" hint="Master workforce reference" />
            </section>

            {comparison.length > 0 ? (
              <ChartCard
                title="Team comparison"
                description="Average performance, attendance and review completion per team"
                summary={comparison.map((row) => `${row.name}: performance ${row.performance.toFixed(1)}, attendance ${row.attendance.toFixed(0)}%`).join("; ") + "."}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={comparison}>
                    <CartesianGrid {...gridStyle} />
                    <XAxis dataKey="name" {...axisStyle} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} unit="%" {...axisStyle} width={40} />
                    <Tooltip {...tooltipStyle} formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]} />
                    <Legend />
                    <Bar dataKey="performance" name="Performance" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="attendance" name="Attendance" fill={CHART_COLORS.workflow} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="review" name="Review completion" fill={CHART_COLORS.insight} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : null}

            <section className="space-y-3">
              <SectionHeader
                title="Teams"
                description="Teams sit below the department. Open a team to see its members, trends and actions."
                actions={<span className="text-xs text-muted-foreground">{metricRows.length} teams</span>}
              />
              {metricRows.length === 0 ? (
                <EmptyState
                  title="No teams yet"
                  description="Create the first team to organise this department's employees."
                  icon={<Layers className="h-5 w-5" aria-hidden="true" />}
                  action={
                    isHr ? (
                      <Button size="sm" onClick={() => { setEditingTeam(null); setTeamFormOpen(true); }}>
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                        Create team
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <DataTable
                  columns={columns}
                  rows={metricRows}
                  getRowId={(row) => row.team.id}
                  initialSort={{ key: "name", direction: "asc" }}
                  pageSize={10}
                  caption="Teams in this department"
                />
              )}
            </section>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
              {summary.openRoles} open requisition slots · department created {formatDate(department.created_at)} · archived teams keep their members and history.
            </p>
          </>
        )}
      </QueryState>

      <TeamFormDialog
        open={teamFormOpen}
        onOpenChange={setTeamFormOpen}
        departmentId={departmentId}
        team={editingTeam}
        onSaved={invalidate}
      />

      <ManageTeamMembersDialog
        open={Boolean(managingTeam)}
        onOpenChange={(open) => (!open ? setManagingTeam(null) : undefined)}
        team={managingTeam}
        departmentName={department?.name ?? "Department"}
        onChanged={invalidate}
      />

      <ConfirmDialog
        open={Boolean(archivingTeam)}
        onOpenChange={(open) => (!open ? setArchivingTeam(null) : undefined)}
        title={`Archive ${archivingTeam?.name ?? "team"}?`}
        description="Archiving is reversible and never deletes employees or historical records. Team members keep their attendance, performance, risk and audit history. Edit and membership changes are disabled while archived."
        confirmLabel="Archive team"
        busy={false}
        onConfirm={() => void archiveTeam()}
      />
    </div>
  );
}
