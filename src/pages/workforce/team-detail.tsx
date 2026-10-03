import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Archive, ArrowLeft, Eye, Gauge, Layers, PenLine, ShieldAlert, Trash2, TrendingUp, UserCog, Users } from "lucide-react";
import { PageHeader, SectionHeader, type Crumb } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, ErrorState, QueryState, TableSkeleton } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ManageTeamMembersDialog, TeamFormDialog, TeamLeadControl } from "@/components/team/team-dialogs";
import { useTeamMetrics } from "@/hooks/use-team-metrics";
import { useAuth } from "@/providers/auth-provider";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { supabase } from "@/lib/db";
import { formatDate, formatPercent, formatScore, initials } from "@/lib/format";
import { toast } from "sonner";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_TONE,
  WORK_MODE_LABELS,
  WORK_MODE_TONE,
  TEAM_STATUS_LABELS,
  TEAM_STATUS_TONE,
  type AttendanceRecord,
  type Department,
  type Employee,
  type PerformanceReview,
  type Signal,
  type Team,
} from "@/lib/types";
import { CHART_COLORS, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

interface EmployeeRow {
  employee: Employee;
  attendanceRate: number | null;
  performanceScore: number | null;
  riskScore: number | null;
  isLead: boolean;
}

export default function TeamDetailPage() {
  const { departmentId = "", teamId = "" } = useParams();
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const { openEmployee360 } = useEmployee360();
  const queryClient = useQueryClient();

  const [manageOpen, setManageOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removeConfirm, setRemoveConfirm] = useState(false);

  useRealtimeRefresh(["hr_teams", "hr_employees"], [["team-detail", teamId]]);

  const { data: department } = useQuery<Department | null>({
    queryKey: ["department", departmentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_departments").select("*").eq("id", departmentId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Department | null) ?? null;
    },
  });

  const { data: team } = useQuery<Team | null>({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_teams").select("*").eq("id", teamId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Team | null) ?? null;
    },
  });

  const metric = useTeamMetrics([teamId]);

  const { data: employees = [], isLoading: employeesLoading, isError: employeesError, refetch: refetchEmployees } = useQuery<Employee[]>({
    queryKey: ["team-members", teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").eq("team_id", teamId).order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const { data: detail } = useQuery<{ attendance: AttendanceRecord[]; reviews: PerformanceReview[]; signals: Signal[] } | null>({
    queryKey: ["team-detail-records", teamId],
    enabled: employees.length > 0,
    queryFn: async () => {
      const ids = employees.map((employee) => employee.id);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const [attendance, reviews, signals] = await Promise.all([
        supabase.from("hr_attendance").select("*").in("employee_id", ids).gte("attendance_date", cutoff.toISOString().slice(0, 10)).limit(20000),
        supabase.from("hr_performance_reviews").select("*").in("employee_id", ids).order("period_end", { ascending: false }).limit(3000),
        supabase.from("hr_signals").select("*").eq("entity_type", "employee").in("entity_id", ids).limit(2000),
      ]);
      const firstError = attendance.error ?? reviews.error ?? signals.error;
      if (firstError) throw new Error(firstError.message);
      return {
        attendance: (attendance.data ?? []) as AttendanceRecord[],
        reviews: (reviews.data ?? []) as PerformanceReview[],
        signals: (signals.data ?? []) as Signal[],
      };
    },
  });

  const rows = useMemo<EmployeeRow[]>(() => {
    const attendance = detail?.attendance ?? [];
    const reviews = detail?.reviews ?? [];
    const signals = detail?.signals ?? [];
    const latestReview = new Map<string, PerformanceReview>();
    const previousReview = new Map<string, PerformanceReview>();
    for (const review of reviews) {
      if (review.status === "draft") continue;
      if (!latestReview.has(review.employee_id)) latestReview.set(review.employee_id, review);
      else if (!previousReview.has(review.employee_id)) previousReview.set(review.employee_id, review);
    }

    return employees.map((employee) => {
      const record = attendance.filter((item) => item.employee_id === employee.id && ["present", "late", "half-day", "absent"].includes(item.status));
      const credited = record.reduce((total, item) => {
        if (item.status === "present") return total + 1;
        if (item.status === "late" || item.status === "half-day") return total + 0.5;
        return total;
      }, 0);
      const employeeSignals = signals.filter((item) => item.entity_id === employee.id);
      const risk = employeeSignals
        .filter((item) => item.signal_type === "combined_risk")
        .sort((a, b) => Number(b.score) - Number(a.score))[0];
      return {
        employee,
        attendanceRate: record.length ? (credited / record.length) * 100 : null,
        performanceScore: latestReview.get(employee.id)?.performance_score ?? null,
        riskScore: risk ? Number(risk.score) : null,
        isLead: employee.id === team?.team_lead_id,
      };
    });
  }, [detail, employees, team?.team_lead_id]);

  const summary = metric.data?.[0];

  const attendanceTrend = useMemo(() => {
    const byDate = new Map<string, { credited: number; total: number }>();
    (detail?.attendance ?? []).forEach((record) => {
      if (!["present", "late", "half-day", "absent"].includes(record.status)) return;
      if (!byDate.has(record.attendance_date)) byDate.set(record.attendance_date, { credited: 0, total: 0 });
      const entry = byDate.get(record.attendance_date)!;
      entry.total += 1;
      if (record.status === "present") entry.credited += 1;
      else if (record.status === "late" || record.status === "half-day") entry.credited += 0.5;
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({ date, rate: entry.total ? Math.round((entry.credited / entry.total) * 1000) / 10 : 0 }));
  }, [detail]);

  const performanceTrend = useMemo(() => {
    const byPeriod = new Map<string, { total: number; count: number }>();
    (detail?.reviews ?? [])
      .filter((review) => review.status !== "draft" && review.performance_score != null)
      .forEach((review) => {
        const key = String(review.period_end).slice(0, 7);
        if (!byPeriod.has(key)) byPeriod.set(key, { total: 0, count: 0 });
        const entry = byPeriod.get(key)!;
        entry.total += Number(review.performance_score);
        entry.count += 1;
      });
    return Array.from(byPeriod.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, entry]) => ({ period, score: Math.round((entry.total / entry.count) * 10) / 10 }));
  }, [detail]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSelected = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("team-management", {
        body: { action: "assign_members", team_id: teamId, remove: Array.from(selected) },
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "Members could not be removed.");
    },
    onSuccess: () => {
      toast.success(`${selected.size} member${selected.size === 1 ? "" : "s"} unassigned.`);
      setRemoveConfirm(false);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-detail-records", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["team-metrics"] });
      void refetchEmployees();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const archiveTeam = async () => {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("team-management", {
      body: { action: "archive", team_id: teamId },
      headers: { "Content-Type": "application/json" },
    });
    if (error || !data?.ok) {
      toast.error(data?.message ?? error?.message ?? "The team could not be archived.");
      return;
    }
    toast.success("Team archived. Members and history preserved.");
    setArchiveOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
  };

  const breadcrumbs: Crumb[] = [
    { label: "Workforce", to: "/workforce/employees" },
    { label: "Departments", to: "/workforce/departments" },
    { label: department?.name ?? "Department", to: `/workforce/departments/${departmentId}` },
    { label: team?.name ?? "Team" },
  ];

  const activeMembers = employees.filter((employee) => employee.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader
        title={team?.name ?? "Team"}
        description={`${team?.team_code ?? ""}${team?.description ? ` · ${team.description}` : ""}`}
        breadcrumbs={breadcrumbs}
        actions={
          isHr ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <PenLine className="mr-2 h-4 w-4" aria-hidden="true" />
                Edit team
              </Button>
              <Button size="sm" onClick={() => setManageOpen(true)}>
                <UserCog className="mr-2 h-4 w-4" aria-hidden="true" />
                Manage members
              </Button>
              {team?.status === "active" ? (
                <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
                  <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                  Archive
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <QueryState
        isLoading={metric.isLoading || employeesLoading}
        isError={metric.isError || employeesError}
        onRetry={() => { void metric.refetch(); void refetchEmployees(); }}
        loadingFallback={<CardSkeleton count={4} />}
      >
        {!team ? (
          <ErrorState title="Team not found" onRetry={() => undefined} />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Headcount" value={summary?.headcount ?? 0} icon={Users} tone="primary" hint={`${summary?.active ?? 0} active · ${summary?.exited ?? 0} exited`} />
              <KpiCard
                label="Capacity utilisation"
                value={summary?.utilization != null ? `${summary.utilization.toFixed(0)}%` : "—"}
                icon={Gauge}
                tone={summary?.utilization != null && summary.utilization > 100 ? "critical" : "success"}
                hint={`${summary?.capacity ?? "—"} planned`}
              />
              <KpiCard label="Average performance" value={formatScore(summary?.averagePerformance)} icon={TrendingUp} tone="insight" hint={summary?.trend != null ? `Trend ${summary.trend >= 0 ? "+" : ""}${summary.trend.toFixed(1)}` : "No prior period"} />
              <KpiCard label="Attendance rate" value={formatPercent(summary?.attendanceRate)} icon={Users} tone={summary?.attendanceRate != null && summary.attendanceRate < 85 ? "warning" : "success"} hint={`${summary?.lateOrAbsent ?? 0} late/absent (30d)`} />
              <KpiCard label="Review completion" value={summary ? `${summary.reviewCompletion.toFixed(0)}%` : "—"} icon={UserCog} tone={summary && summary.reviewCompletion >= 90 ? "success" : "warning"} hint="Submitted reviews" />
              <KpiCard label="Open risks" value={summary?.highCriticalRisks ?? 0} icon={ShieldAlert} tone={(summary?.highCriticalRisks ?? 0) > 0 ? "critical" : "success"} hint="High or critical" />
              <KpiCard label="Open actions" value={summary?.openActions ?? 0} icon={Gauge} tone="workflow" hint="Linked to this team" />
              <KpiCard label="Status" value={TEAM_STATUS_LABELS[team.status]} icon={Layers} tone={TEAM_STATUS_TONE[team.status]} hint={`Lead: ${summary?.leadName ?? "Not assigned"}`} />
            </section>

            {isHr ? (
              <section className="rounded-lg border border-border bg-card p-5 shadow-card">
                <TeamLeadControl team={team} onChanged={() => { void metric.refetch(); void queryClient.invalidateQueries({ queryKey: ["team-metrics"] }); }} />
              </section>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Attendance trend"
                description="Daily attendance rate · last 90 days"
                summary={`Team attendance rate per day over the last 90 days. Latest ${attendanceTrend.at(-1)?.rate ?? 0} percent.`}
              >
                {attendanceTrend.length === 0 ? (
                  <EmptyState title="No attendance records" description="Import attendance to populate the team trend." />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={attendanceTrend}>
                      <defs>
                        <linearGradient id="teamAtt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.workflow} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={CHART_COLORS.workflow} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridStyle} />
                      <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} {...axisStyle} />
                      <YAxis domain={[0, 100]} unit="%" {...axisStyle} width={40} />
                      <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Attendance"]} />
                      <Area type="monotone" dataKey="rate" stroke={CHART_COLORS.workflow} strokeWidth={2} fill="url(#teamAtt)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard
                title="Performance trend"
                description="Average performance score by review period"
                summary={performanceTrend.map((entry) => `${entry.period}: ${entry.score}`).join(", ") + "."}
              >
                {performanceTrend.length === 0 ? (
                  <EmptyState title="No submitted reviews" description="Submit a performance review to build the team trend." />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={performanceTrend}>
                      <CartesianGrid {...gridStyle} />
                      <XAxis dataKey="period" {...axisStyle} />
                      <YAxis domain={[0, 100]} {...axisStyle} width={40} />
                      <Tooltip {...tooltipStyle} />
                      <Line type="monotone" dataKey="score" stroke={CHART_COLORS.insight} strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            <section className="space-y-3">
              <SectionHeader
                title="Team members"
                description={`${activeMembers.length} active of ${employees.length} total. Select rows to remove them from the team.`}
                actions={
                  isHr && selected.size > 0 ? (
                    <Button variant="outline" size="sm" onClick={() => setRemoveConfirm(true)}>
                      <Trash2 className="mr-2 h-4 w-4 text-destructive" aria-hidden="true" />
                      Remove {selected.size} selected
                    </Button>
                  ) : undefined
                }
              />

              <div className="hr-scroll-area w-full overflow-x-auto rounded-lg border border-border bg-card shadow-card">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <span className="sr-only">Select</span>
                      </th>
                      {["Employee", "Type", "Status", "Work mode", "Attendance", "Performance", "Risk"].map((header) => (
                        <th key={header} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {header}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.employee.id}
                        className={`border-b border-border/70 last:border-0 transition-colors ${selected.has(row.employee.id) ? "bg-primary-soft" : "hover:bg-muted/40"}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(row.employee.id)}
                            onChange={() => toggle(row.employee.id)}
                            className="h-4 w-4 rounded border-input accent-primary"
                            aria-label={`Select ${row.employee.full_name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-3 text-left"
                            onClick={() => openEmployee360(row.employee.id)}
                          >
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
                                {initials(row.employee.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {row.employee.full_name}
                                {row.isLead ? (
                                  <ToneBadge tone="insight" className="ml-2">
                                    Team lead
                                  </ToneBadge>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                <span className="font-mono">{row.employee.code}</span> · {row.employee.job_title ?? "—"}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={row.employee.employment_type} labels={EMPLOYMENT_TYPE_LABELS} tones={EMPLOYMENT_TYPE_TONE} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={row.employee.status} labels={EMPLOYEE_STATUS_LABELS} tones={EMPLOYEE_STATUS_TONE} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={row.employee.work_mode} labels={WORK_MODE_LABELS} tones={WORK_MODE_TONE} />
                        </td>
                        <td className="px-4 py-3 tabular-nums">{formatPercent(row.attendanceRate)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatScore(row.performanceScore)}</td>
                        <td className="px-4 py-3">
                          {row.riskScore != null ? (
                            <RiskBadge score={row.riskScore} />
                          ) : (
                            <ToneBadge tone="neutral">No signal</ToneBadge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="icon" aria-label={`Open 360 for ${row.employee.full_name}`} onClick={() => openEmployee360(row.employee.id)}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length === 0 && !employeesLoading ? (
                <EmptyState
                  title="No members in this team"
                  description="Add employees from the department to this team."
                  action={
                    isHr ? (
                      <Button size="sm" onClick={() => setManageOpen(true)}>
                        <UserCog className="mr-2 h-4 w-4" aria-hidden="true" />
                        Manage members
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}
            </section>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to{" "}
              <Link to={`/workforce/departments/${departmentId}`} className="underline underline-offset-2 hover:text-primary">
                {department?.name ?? "department"}
              </Link>
            </p>
          </>
        )}
      </QueryState>

      <ManageTeamMembersDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        team={team}
        departmentName={department?.name ?? "Department"}
        onChanged={() => {
          void refetchEmployees();
          void queryClient.invalidateQueries({ queryKey: ["team-detail-records", teamId] });
          void queryClient.invalidateQueries({ queryKey: ["team-metrics"] });
        }}
      />

      <TeamFormDialog open={editOpen} onOpenChange={setEditOpen} departmentId={departmentId} team={team} onSaved={() => void queryClient.invalidateQueries({ queryKey: ["team", teamId] })} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${team?.name ?? "team"}?`}
        description="Archiving is reversible and never deletes employees or historical records. Team members and their attendance, performance, risk and audit history are preserved."
        confirmLabel="Archive team"
        busy={false}
        onConfirm={() => void archiveTeam()}
      />

      <ConfirmDialog
        open={removeConfirm}
        onOpenChange={setRemoveConfirm}
        title={`Remove ${selected.size} member${selected.size === 1 ? "" : "s"} from this team?`}
        description="Removed members are unassigned — never deleted — and keep all of their records. If the team lead is selected, the lead is cleared."
        confirmLabel="Remove from team"
        destructive
        busy={removeSelected.isPending}
        onConfirm={() => removeSelected.mutate()}
      />
    </div>
  );
}
